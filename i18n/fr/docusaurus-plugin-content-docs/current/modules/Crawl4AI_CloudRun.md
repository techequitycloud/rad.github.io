---
title: "Crawl4AI sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Crawl4AI sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Crawl4AI_CloudRun.md @ 1665a43e sha256:4fce22a81784 -->

# Crawl4AI sur Google Cloud Run {#crawl4ai-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Crawl4AI_CloudRun.png" alt="Crawl4AI sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Crawl4AI est un robot d'exploration et de scraping web open source, compatible
avec les LLM. Ce module déploie Crawl4AI sur **Cloud Run v2** sur la base de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Crawl4AI et sur la
manière de les explorer et de les utiliser depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Crawl4AI sur RAD, et comment cela se compare {#what-crawl4ai-costs-on-rad-and-how-that-compares}

**Crawl4AI sur le module Cloud Run de RAD coûte environ 22,33 $ US par mois
dans un projet Google Cloud que vous possédez, plus des frais de module
uniques de 40 crédits (4 $ US).** Crawl4AI est un robot d'exploration et de
scraping web open source, compatible avec les LLM, pour les pipelines
d'ingestion RAG. GKE Autopilot convient à Crawl4AI qui doit rester actif,
s'adapter à travers les pods ou s'exécuter à côté d'autres charges de travail
Kubernetes ; pour le coût le plus bas, ce module Cloud Run est généralement le
bon choix — voir le [guide GKE](Crawl4AI_GKE.md) si vous avez besoin de
l'autre.

Si Crawl4AI n'est nécessaire qu'occasionnellement — une démo, un essai, une
charge de travail saisonnière ou d'étude — un projet géré par RAD peut être
supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte
que 22,33 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause
gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **22,33 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour**, environ 90 par mois (environ 9 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, moins sur un plan. Dans
un projet géré par RAD, la base de données, le serveur de fichiers et le réseau
sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 4 GiB (scaleToZero) | 16,33 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 22,33 $ US** |

### Comment cela se compare {#how-it-compares}

- Si vous l'exécutez vous-même, un VPS exécutant le propre conteneur de Crawl4AI
  coûte moins cher en espèces : dimensionné à environ 1 vCPU/4 GiB, un VPS
  comparable (Hetzner ou DigitalOcean) coûte environ 24 à 48 $ par mois, ou une
  VM GCP de classe `e2-standard-2` environ 49 $ — plus votre propre temps pour les
  sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL
  géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes
  monétaires — ce n'est généralement pas le cas. La différence est ce que RAD
  gère pour vous : les correctifs, les sauvegardes, les secrets et la
  surveillance, plus la possibilité de mettre Crawl4AI en pause gratuitement
  plutôt que de payer pour une capacité inactive (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Crawl4AI s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à Crawl4AI dont vous n'avez besoin qu'occasionnellement
que de l'exécuter en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  qu'il attend. Contrairement à la suppression d'un module, cela ne démolit pas
  les ressources Cloud Run une par une — l'ensemble du projet, et tout ce qu'il
  contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.**
  Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total
  pour une chaîne Crawl4AI typique, contre les 45 crédits que coûte un
  redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 22,33 $ US.** Déployez Crawl4AI, utilisez-le, supprimez le projet.
  Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec
  Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez
  que les frais de module une fois, les builds et les heures où il était
  réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du palier (100
  crédits pour le palier sandbox que la plupart des utilisations d'étude et de
  démo conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et
  ce bucket n'est **pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé Crawl4AI et que vous souhaitez conserver ce travail,
  copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet)
  avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run s'adapte déjà à zéro entre les requêtes. L'option ci-dessus ne
s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une
fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 45 crédits (4,50 $ US) dans votre propre projet. La
  suppression ne permet d'économiser de l'argent que si Crawl4AI resterait
  inutilisé pendant environ 7 jours ou plus dans votre propre projet (0,74 $ US
  par jour), ou environ 14 jours ou plus dans un projet géré par RAD (3 crédits
  par jour).
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites
  dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci,
  alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez
  la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour
  vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille est
  faible, la facturation est suspendue et les données sont conservées, de sorte
  que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets
Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Crawl4AI s'exécute en tant que conteneur Python/ASGI sur Cloud Run v2 Gen2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 (Gen2) | Service Python, 1 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes |
| File d'attente de tâches | Redis intégré (dans le conteneur) | Supervisord démarre Redis à l'intérieur du conteneur ; éphémère par instance |
| Serveur ASGI | Gunicorn intégré (dans le conteneur) | Port 11235, géré par supervisord avec Redis |
| Stockage d'objets | Cloud Storage | Buckets optionnels pour la mise en cache des résultats d'exploration (aucun par défaut) |
| Secrets | Secret Manager | Clés API et secret JWT injectés au moment de l'exécution |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app`, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type` est fixé à `NONE` —
  Cloud SQL n'est pas provisionné. Tout l'état des tâches réside dans
  l'instance Redis intégrée au conteneur et est perdu lorsque le conteneur
  redémarre.
- **Gen2 est requis.** Supervisord a besoin d'un arbre de processus Linux
  complet, et Chromium utilise `/tmp` pour la mémoire partagée via
  `--disable-dev-shm-usage`. Gen1 ne peut pas prendre en charge cela.
- **L'egress `ALL_TRAFFIC` est requis.** Le robot d'exploration doit atteindre
  des URL publiques arbitraires sur Internet ; `PRIVATE_RANGES_ONLY` bloque toutes les
  cibles d'exploration externes.
- **Redis s'exécute à l'intérieur du conteneur.** Ne définissez pas
  `REDIS_HOST` ou `REDIS_PORT` comme variables d'environnement —
  elles doivent rester à `localhost:6379` pour atteindre l'instance
  groupée.
- **La sécurité est désactivée par défaut.** L'authentification JWT
  nécessite de fournir un `SECRET_KEY` via `secret_environment_variables` et un
  `config.yml` personnalisé avec `security.jwt_enabled=true`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Crawl4AI {#a-cloud-run--the-crawl4ai-service}

Crawl4AI s'exécute en tant que service Cloud Run v2 Gen2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs. Chaque
instance exécute son propre arbre supervisord : Redis (priorité 10) démarre en
premier, puis Gunicorn (priorité 20).

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

### B. Redis intégré et file d'attente de tâches {#b-embedded-redis-and-task-queue}

Redis s'exécute à l'intérieur de chaque instance de conteneur en tant que
processus géré par supervisord sur `localhost:6379`. Il stocke les résultats des
tâches avec un TTL configurable (`redis_task_ttl_seconds`, 3600 s par défaut). Les
résultats des tâches sont perdus lorsque le conteneur redémarre — c'est
attendu pour une API d'exploration éphémère. Il n'y a pas d'instance
Memorystore ; le Redis intégré n'apparaît pas dans la console.

Il n'y a pas d'accès direct au shell sur Cloud Run, mais vous pouvez observer
le comportement de Redis à partir des journaux :

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" \
  --filter="supervisord" --limit 50
```

### C. Cloud Storage (facultatif) {#c-cloud-storage-optional}

Crawl4AI n'a pas de bucket GCS par défaut — il est sans état. Des buckets
optionnels peuvent être provisionnés via `storage_buckets` pour stocker les
résultats d'exploration ou des fichiers `config.yml` personnalisés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<results-bucket>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Les clés API LLM et le secret de signature JWT sont stockés en tant que secrets
Secret Manager et injectés dans le service au moment de l'exécution ; le texte
en clair n'apparaît jamais dans la configuration. Crawl4AI n'a pas de secrets
auto-générés — tous les secrets doivent être fournis via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Noms de secrets reconnus (passez le nom du secret Secret Manager, pas la
valeur) : `SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`,
`GROQ_API_KEY`, `GEMINI_API_KEY`, `LLM_API_KEY`.

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut avec
`ingress_settings = "all"`. Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peut être ajouté. L'egress VPC est
défini sur `ALL_TRAFFIC` afin que le robot d'exploration puisse atteindre
des URL publiques arbitraires.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneur (sortie Python diffusée via `PYTHONUNBUFFERED=1`) sont
envoyés à Cloud Logging. Les métriques Cloud Run sont envoyées à Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte
optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Crawl4AI {#3-crawl4ai-application-behaviour}

- **Séquence de démarrage de Supervisord.** À chaque démarrage de conteneur,
  supervisord (PID 1) démarre Redis en premier (priorité 10), puis Gunicorn
  (priorité 20). Le point de terminaison `/health` ne répond qu'après que
  les deux processus sont prêts — prévoyez au moins 40 secondes de délai
  initial avant le début des vérifications de santé.
- **Points de terminaison de l'API REST.** Crawl4AI expose :

  | Point de terminaison | Méthode | Objectif |
  |---|---|---|
  | `/crawl` | POST | Soumet un job d'exploration asynchrone ; renvoie un `task_id` |
  | `/task/{id}` | GET | Interroge l'état et récupère les résultats d'une tâche |
  | `/crawl/sync` | POST | Exploration synchrone (bloque jusqu'à la fin) |
  | `/health` | GET | Vérification de santé — renvoie `{"status":"ok"}` lorsqu'il est prêt |
  | `/playground` | GET | Interface utilisateur d'exploration interactive basée sur le navigateur |

- **Cycle de vie des résultats de tâche.** Les résultats d'exploration
  asynchrones sont stockés dans le Redis intégré avec un TTL de
  `redis_task_ttl_seconds` (1 heure par défaut). Après l'expiration du TTL, le résultat
  disparaît. Il n'y a pas de stockage de résultats durable.
- **Pas de migrations de base de données ni de jobs d'initialisation.**
  Crawl4AI est entièrement sans état — `Crawl4AI_Common` ne fournit aucun job
  d'initialisation. Aucune configuration de base de données n'est requise.
- **Extraction basée sur LLM.** Fournissez les clés API LLM via
  `secret_environment_variables` et définissez `LLM_PROVIDER` (ou des clés
  spécifiques au fournisseur telles que `OPENAI_API_KEY`) via `environment_variables`
  pour activer l'extraction de contenu basée sur l'IA.
- **Authentification JWT (facultatif).** La sécurité est désactivée par
  défaut. Pour l'activer, fournissez `SECRET_KEY` via `secret_environment_variables` et
  fournissez un `config.yml` personnalisé avec `security.jwt_enabled=true`. Le point
  de terminaison `/token` émet des JWT de courte durée lorsque
  l'authentification est activée.
- **Avertissement `CRAWL4AI_HOOKS_ENABLED`.** La définition de cette variable sur
  `"true"` active l'exécution de code Python arbitraire via des hooks
  webhook. N'activez que dans un environnement entièrement fiable.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Crawl4AI sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `crawl4ai` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Crawl4AI Web Crawler` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `0.7.8` | Version de l'image Crawl4AI ; épingler à une balise spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure sans déployer le conteneur. |
| `cpu_limit` | `1000m` | CPU par instance ; ~0,5–1 vCPU par contexte de navigateur actif. |
| `memory_limit` | `4Gi` | Mémoire par instance. Minimum 4 GiB pour un fonctionnement stable de Chromium ; 8 GiB recommandés pour les explorations concurrentes. |
| `min_instance_count` | `0` | Instances minimales. Définir à 1 pour un pool Chromium chaud ; `0` par défaut provoque des démarrages à froid de 30 à 60 s. |
| `max_instance_count` | `3` | Instances maximales (plafond de coût). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — une exploration s'exécute de manière synchrone dans sa requête HTTP sans travail en arrière-plan post-réponse, de sorte que la limitation du CPU entre les requêtes est sûre. |
| `execution_environment` | `gen2` | **Requis** — Gen2 pour l'arbre de processus de supervisord et la mémoire partagée `/tmp` de Chromium. |
| `timeout_seconds` | `3600` | Durée maximale de la requête ; définie sur le maximum de Cloud Run pour permettre de longs jobs d'exploration par lots. |
| `container_protocol` | `http1` | Version du protocole HTTP. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Crawl4AI vers Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `traffic_split` | `[]` | Allocation de trafic canari/bleu-vert basée sur un pourcentage entre les révisions. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Sources de trafic autorisées à atteindre le service. Utilisez `"internal-and-cloud-load-balancing"` lorsqu'il est précédé de Cloud Armor. |
| `vpc_egress_setting` | `ALL_TRAFFIC` | **Requis** — achemine tout le trafic sortant via le VPC afin que le robot d'exploration puisse atteindre des URL publiques arbitraires. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global avec Cloud Armor WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `PYTHONUNBUFFERED` et `REDIS_TASK_TTL` sont définis automatiquement. **Ne définissez pas `REDIS_HOST` ou `REDIS_PORT`**. Substitutions reconnues : `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_TEMPERATURE`, `CRAWL4AI_HOOKS_ENABLED`. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. Utilisez pour `SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Non applicable pour Crawl4AI — le service est sans état et ne contient pas de
base de données. `backup_schedule`, `backup_retention_days` et `enable_backup_import` sont
présents pour la compatibilité d'interface mais n'ont aucun effet.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Jobs et SQL personnalisé {#group-9--jobs--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Crawl4AI_Common ne fournit pas de job d'initialisation par défaut — laissez vide sauf si une étape de configuration personnalisée est nécessaire. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents optionnels déclenchés par Cloud Scheduler. |
| `enable_custom_sql_scripts` | `false` | Non applicable pour Crawl4AI (pas de base de données). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne tous les buckets listés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Aucun bucket par défaut — Crawl4AI est sans état. Ajoutez des entrées pour provisionner des buckets de résultats d'exploration. |
| `enable_nfs` | `false` | Provisionne un volume NFS Filestore. Non requis pour les déploiements Crawl4AI standard. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — aucune instance Cloud SQL n'est provisionnée pour Crawl4AI. |

Toutes les autres variables de base de données (`enable_cloudsql_volume`, `database_password_length`,
etc.) sont présentes pour la compatibilité d'interface et n'ont aucun effet.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, 40 s de délai | Laisse le temps à supervisord de démarrer Redis puis Gunicorn avant que la première sonde ne se déclenche. |
| `health_check_config` / `liveness_probe` | HTTP `/health`, 60 s de délai | Sonde de vivacité après le démarrage. |
| `uptime_check_config` | désactivé par défaut, chemin `/health` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 19 — Paramètres de l'application Crawl4AI {#group-19--crawl4ai-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `redis_task_ttl_seconds` | `3600` | TTL en secondes pour les résultats de tâche dans Redis intégré. Plage valide : 300–86400. Trop court, les résultats expirent avant que les clients ne les interrogent ; trop long, cela provoque une croissance illimitée de la mémoire. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
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
| `vpc_egress_setting` | `ALL_TRAFFIC` | Critique | L'utilisation de `PRIVATE_RANGES_ONLY` bloque toutes les cibles d'exploration externes ; toute exploration vers une URL publique échoue avec une erreur de connexion. |
| `memory_limit` | `8Gi` | Critique | En dessous de 4 GiB, les processus Chromium sont tués par OOM en cours d'exploration, renvoyant des résultats partiels ; en dessous de 2 GiB, le conteneur ne démarre pas. |
| `REDIS_HOST` / `REDIS_PORT` (variables d'environnement) | ne pas définir | Critique | La surcharge de ces variables rompt la connexion Redis intégrée ; tous les jobs d'exploration asynchrones échouent immédiatement. |
| `database_type` | `NONE` | Critique | Crawl4AI n'a pas de base de données ; la modification de cela entraîne un provisionnement Cloud SQL inutile et un échec de démarrage. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne peut pas exécuter l'arbre de processus de supervisord ; le service ne parvient pas à se déployer avec la configuration réseau VPC. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro (`0`) provoque des démarrages à froid de 30 à 60 s (supervisord doit démarrer Redis puis Gunicorn) ; la première requête expire généralement. |
| `cpu_limit` | `4000m` | Élevé | En dessous de 2000m, le rendu Chromium déclenche des délais d'attente internes sur les pages complexes ; le débit d'exploration diminue considérablement. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | Avec `ingress_settings = "all"`, l'API est accessible publiquement et n'importe qui peut soumettre des jobs d'exploration consommant des ressources cloud. |
| `LLM_API_KEY` / clés API du fournisseur | via `secret_environment_variables` | Élevé | Les clés manquantes ou expirées entraînent l'échec silencieux de l'extraction basée sur LLM (`extracted_content` vide). Injectez-les en tant que secrets, pas en tant que variables d'environnement en texte clair. |
| `redis_task_ttl_seconds` | `3600` | Moyen | Trop court (< 300 s), les résultats expirent avant que les clients asynchrones ne les interrogent ; trop long, cela provoque une croissance illimitée de la mémoire. Plage valide : 300–86400. |
| `timeout_seconds` | `3600` | Moyen | Les explorations profondes ou l'extraction LLM de grandes pages peuvent prendre plusieurs minutes ; réduisez uniquement pour les API de courte durée où les requêtes zombies doivent être terminées plus rapidement. |
| `application_version` | balise épinglée | Moyen | L'utilisation de `"latest"` n'est pas reproductible ; une reconstruction peut entraîner un changement d'API Crawl4AI cassant. |
| `enable_image_mirroring` | `true` | Faible | Les images Crawl4AI sont volumineuses ; sans mise en miroir, chaque déploiement tire de Docker Hub et risque des échecs de limite de débit et des démarrages à froid lents. |

---

Pour le comportement de base référencé tout au long — identité de service, mise
à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application partagée
spécifique à Crawl4AI est décrite dans
**[Crawl4AI_Common](Crawl4AI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Crawl4AI sur Cloud Run](../labs/Crawl4AI_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de console et les commandes à
  chaque étape.
- [Crawl4AI sur GKE Autopilot](Crawl4AI_GKE.md) — la même application sur
  Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Crawl4AI Common — Configuration d'application partagée](Crawl4AI_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md),
  [RAGFlow sur GKE Autopilot](RAGFlow_GKE.md), [Qdrant sur Google Cloud
  Run](Qdrant_CloudRun.md), [Paperless-ngx sur Google Cloud
  Run](Paperless_CloudRun.md) dans la solution **Enterprise RAG & Document
  Intelligence**.
