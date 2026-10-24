---
title: "Crawl4AI sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Crawl4AI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Crawl4AI_GKE.md @ 1665a43e sha256:8252f4eecd49 -->

# Crawl4AI sur GKE Autopilot {#crawl4ai-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Crawl4AI_GKE.png" alt="Crawl4AI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Crawl4AI est un robot d'exploration et de scraping web open-source, compatible
avec les LLM. Ce module déploie Crawl4AI sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Crawl4AI et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte Crawl4AI sur RAD, et comment cela se compare {#what-crawl4ai-costs-on-rad-and-how-that-compares}

**Le module Crawl4AI sur GKE Autopilot de RAD coûte environ 164,69 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 175 crédits (17,50 $ US).** Crawl4AI est un robot d'exploration et de scraping web open-source, compatible avec les LLM, pour les pipelines d'ingestion RAG. Pour le coût le plus bas, le [guide Cloud Run](Crawl4AI_CloudRun.md) exécute le même Crawl4AI pour environ 22,33 $ US par mois ; choisissez GKE ici uniquement si Crawl4AI doit rester actif en permanence, s'adapter à travers les pods ou fonctionner à côté d'autres charges de travail Kubernetes.

Si Crawl4AI n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que 164,69 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3–6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **164,69 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **117 crédits par jour**, soit environ 3510 par mois (environ 351 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 4x vCPU / 8 Gio | 158,69 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 164,69 $ US** |

### Comment cela se compare {#how-it-compares}

- Si vous l'exécutez vous-même, un VPS exécutant le propre conteneur de Crawl4AI coûte moins cher en espèces : dimensionné à environ 4 vCPU/8 Gio, un VPS comparable (Hetzner ou DigitalOcean) coûte environ 24–48 $ par mois, ou une VM GCP de classe `e2-standard-2` environ 49 $ — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence réside dans ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, ainsi que la possibilité de mettre Crawl4AI en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Crawl4AI s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Crawl4AI dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne démantèle pas les ressources GKE Autopilot une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne Crawl4AI typique, contre les 180 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 164,69 $ US.** Déployez Crawl4AI, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Crawl4AI et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si Crawl4AI resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (5,49 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (117 crédits par jour).
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres de RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Crawl4AI s'exécute en tant que service Python/ASGI géré par supervisord. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python, 4 vCPU / 8 Gio par défaut, mise à l'échelle horizontale automatique |
| File d'attente de tâches | Redis intégré (dans le pod) | Supervisord démarre Redis à l'intérieur du conteneur ; éphémère par pod |
| Serveur ASGI | Gunicorn intégré (dans le pod) | Port 11235, géré par supervisord avec Redis |
| Stockage d'objets | Cloud Storage | Buckets optionnels pour la mise en cache des résultats d'exploration (aucun par défaut) |
| Secrets | Secret Manager | Clés API et secret JWT injectés au moment de l'exécution |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type` est fixé à `NONE` — Cloud SQL n'est pas provisionné. Tout l'état des tâches réside dans l'instance Redis intégrée au pod et est perdu lorsque le pod redémarre.
- **Gen2 n'est pas un problème sur GKE.** Contrairement à Cloud Run, GKE fournit un arbre de processus Linux approprié, de sorte que supervisord s'exécute sans contrainte. Chromium obtient un véritable volume emptyDir `/dev/shm` — la solution de contournement Cloud Run `--disable-dev-shm-usage` n'est pas nécessaire.
- **Redis s'exécute à l'intérieur du pod.** Ne définissez pas `REDIS_HOST` ou `REDIS_PORT` comme variables d'environnement — elles doivent rester à `localhost:6379` pour atteindre l'instance groupée.
- **L'affinité de session est `None`.** Les ID de tâche émis par un pod ne sont pas visibles par les autres pods ; les clients interrogeant l'état des tâches doivent acheminer les requêtes vers le pod d'origine ou utiliser des appels d'exploration synchrones (`POST /crawl/sync`).
- **La sécurité est désactivée par défaut.** L'authentification JWT nécessite de fournir un `SECRET_KEY` via `secret_environment_variables` et un `config.yml` personnalisé avec `security.jwt_enabled=true`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Crawl4AI {#a-gke-autopilot--the-crawl4ai-workload}

Les pods Crawl4AI s'exécutent sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et maximal de réplicas. Chaque pod exécute
son propre arbre supervisord : Redis (priorité 10) démarre en premier, puis
Gunicorn (priorité 20).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Crawl4AI pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Confirm supervisord is managing both processes:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- supervisorctl status
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Redis intégré et file d'attente de tâches {#b-embedded-redis-and-task-queue}

Redis s'exécute à l'intérieur de chaque pod en tant que processus géré par
supervisord sur `localhost:6379`. Il stocke les résultats des tâches avec un TTL
configurable (`redis_task_ttl_seconds`, 3600 s par défaut). Les résultats des tâches sont
perdus lorsque le pod redémarre — c'est normal pour une API d'exploration
éphémère. Il n'y a pas d'instance Memorystore ; le Redis intégré n'apparaît pas
dans la Console.

- **CLI (depuis l'intérieur d'un pod) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli info keyspace
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli dbsize
  ```

### C. Cloud Storage (optionnel) {#c-cloud-storage-optional}

Crawl4AI n'a pas de bucket GCS par défaut — il est sans état. Des buckets
optionnels peuvent être provisionnés via `storage_buckets` pour stocker les résultats
d'exploration ou des fichiers `config.yml` personnalisés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<results-bucket>/
  ```

Voir [App_GKE](App_GKE.md) pour les montages GCS Fuse et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Les clés API LLM et le secret de signature JWT sont stockés en tant que secrets
Secret Manager et injectés dans les pods au moment de l'exécution ; le texte en
clair n'apparaît jamais dans la configuration. Crawl4AI n'a pas de secrets
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

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (journaux Python via `PYTHONUNBUFFERED=1`) sont
acheminées vers Cloud Logging. Les métriques GKE sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte
optionnelles sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Crawl4AI {#3-crawl4ai-application-behaviour}

- **Séquence de démarrage de Supervisord.** À chaque démarrage de pod,
  supervisord (PID 1) démarre d'abord Redis (priorité 10), puis Gunicorn
  (priorité 20). Le point de terminaison `/health` ne répond qu'après que les
  deux processus soient prêts — prévoyez au moins 40 secondes de délai initial
  avant le début des vérifications de santé.
- **Points de terminaison de l'API REST.** Crawl4AI expose :

  | Point de terminaison | Méthode | Objectif |
  |---|---|---|
  | `/crawl` | POST | Soumettre un job d'exploration asynchrone ; renvoie un `task_id` |
  | `/task/{id}` | GET | Interroger l'état et récupérer les résultats d'une tâche |
  | `/crawl/sync` | POST | Exploration synchrone (bloque jusqu'à la fin) |
  | `/health` | GET | Vérification de santé — renvoie `{"status":"ok"}` lorsqu'il est prêt |
  | `/playground` | GET | Interface utilisateur d'exploration interactive basée sur le navigateur |

- **Cycle de vie des résultats de tâche.** Les résultats d'exploration
  asynchrone sont stockés dans le Redis intégré avec un TTL de `redis_task_ttl_seconds` (1
  heure par défaut). Après l'expiration du TTL, le résultat est perdu. Il n'y a
  pas de stockage de résultats durable.
- **Pas de migrations de base de données ni de jobs d'initialisation.**
  Crawl4AI est entièrement sans état — `Crawl4AI_Common` ne fournit aucun job
  d'initialisation. Aucune configuration de base de données n'est requise.
- **Extraction basée sur LLM.** Fournissez les clés API LLM via `secret_environment_variables` et
  définissez `LLM_PROVIDER` (ou des clés spécifiques au fournisseur telles que
  `OPENAI_API_KEY`) via `environment_variables` pour activer l'extraction de contenu
  pilotée par l'IA.
- **Authentification JWT (optionnelle).** La sécurité est désactivée par
  défaut. Pour l'activer, fournissez `SECRET_KEY` via `secret_environment_variables` et un
  `config.yml` personnalisé avec `security.jwt_enabled=true`. Le point de terminaison
  `/token` émet des JWT de courte durée lorsque l'authentification est
  activée.
- **Avertissement `CRAWL4AI_HOOKS_ENABLED`.** La définition de cette variable à `"true"`
  active l'exécution de code Python arbitraire via des hooks de webhook.
  N'activez que dans un environnement entièrement fiable.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Crawl4AI sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `crawl4ai` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Crawl4AI Web Crawler` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `0.7.8` | Tag de version de l'image Crawl4AI ; épingler à un tag spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner IAM sans déployer la charge de travail. |
| `workload_type` | `null` | `"Deployment"` (par défaut, sans état) ou `"StatefulSet"` pour la mise en cache basée sur PVC. |
| `container_resources` | `{ cpu_limit="4", memory_limit="8Gi", cpu_request="2", mem_request="4Gi" }` | CPU et mémoire du conteneur. Minimum 4 Gio de mémoire pour un fonctionnement stable de Chromium. |
| `min_instance_count` | `1` | Réplicas minimum. Gardez ≥ 1 pour qu'un pool Chromium chaud soit toujours disponible. |
| `max_instance_count` | `5` | Réplicas maximum (plafond de l'autoscaler). |
| `timeout_seconds` | `1800` | Délai de grâce de terminaison du pod ; définissez ≥ 1800 pour permettre aux longues explorations par lots de se vider. |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM avant de tuer de force. |
| `service_type` | `LoadBalancer` | Comment le Service est exposé. Utilisez `ClusterIP` pour un accès interne au cluster uniquement. |
| `session_affinity` | `None` | Pas de routage persistant — les ID de tâche sont locaux au pod ; utilisez `/crawl/sync` pour une fiabilité inter-pod. |
| `container_image_source` | `prebuilt` | `"prebuilt"` utilise `unclecode/crawl4ai` directement ; `"custom"` construit via Cloud Build. |
| `container_image` | `unclecode/crawl4ai` | URI de l'image lorsque `container_image_source = "prebuilt"`. |
| `enable_image_mirroring` | `true` | Mettez l'image en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `PYTHONUNBUFFERED` et `REDIS_TASK_TTL` sont définis automatiquement. **Ne définissez pas `REDIS_HOST` ou `REDIS_PORT`**. Surcharges reconnues : `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_TEMPERATURE`, `CRAWL4AI_HOOKS_ENABLED`. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. Utilisez pour `SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster cible. Laissez vide pour la découverte automatique. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de sélection de cluster. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré à partir du préfixe de ressource s'il est vide. |
| `enable_multi_cluster_service` | `false` | Activer Multi-Cluster Services ServiceExport. |
| `reserve_static_ip` | `true` | Réservez une IP externe statique pour l'équilibreur de charge afin que l'adresse survive aux redéploiements (par défaut pour la flotte selon la campagne GKE — une IP éphémère peut autrement laisser `GKE_SERVICE_URL`/une configuration auto-référencée pointant vers un DNS interne inaccessible). |
| `static_ip_name` | `""` | Nom d'une IP statique existante à utiliser. Laissez vide pour la création automatique. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

Non applicable pour Crawl4AI — le service est sans état et ne contient pas de
base de données. `backup_schedule`, `backup_retention_days` et `enable_backup_import` sont
présents pour la compatibilité de l'interface mais n'ont aucun effet.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_cpu_requests` | `8` | Total des requêtes CPU autorisées sur tous les pods. |
| `quota_cpu_limits` | `16` | Total des limites CPU autorisées. |
| `quota_memory_requests` | `32Gi` | **Doit utiliser des unités binaires (`32Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |
| `quota_memory_limits` | `64Gi` | **Doit utiliser des unités binaires** — même contrainte que `quota_memory_requests`. |
| `quota_max_pods` | `20` | Nombre maximal de pods dans l'espace de noms. |

### Groupe 9 — CI/CD et intégration GitHub {#group-9--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 10 — Jobs et tâches planifiées {#group-10--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Crawl4AI_Common ne fournit pas de job d'initialisation par défaut — laissez vide sauf si une étape de configuration personnalisée est nécessaire. |
| `cron_jobs` | `[]` | CronJobs Kubernetes optionnels (par exemple, explorations périodiques de préchauffage du cache). |

### Groupe 11 — Cloud Storage et Artifact Registry {#group-11--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner tous les buckets listés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Aucun bucket par défaut — Crawl4AI est sans état. Ajoutez des entrées pour provisionner des buckets de résultats d'exploration. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — aucune instance Cloud SQL n'est provisionnée pour Crawl4AI. |

Toutes les autres variables de base de données (`enable_cloudsql_volume`, `sql_instance_name`,
etc.) sont présentes pour la compatibilité de l'interface et n'ont aucun effet.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, délai initial de 40 s | Laissez le temps à supervisord de démarrer Redis puis Gunicorn avant que la première sonde ne se déclenche. |
| `health_check_config` / `liveness_probe` | HTTP `/health`, délai initial de 60 s | Sonde de vivacité après le démarrage. |
| `uptime_check_config` | désactivé | Vérification de disponibilité optionnelle de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 16 — Fonctionnalités GKE avancées {#group-16--advanced-gke-features}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. Ignoré automatiquement lorsque `max_instance_count ≤ 1`. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |
| `enable_network_segmentation` | `false` | Appliquer des NetworkPolicies Kubernetes pour isoler l'espace de noms. |

### Groupe 17 — StatefulSet {#group-17--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC si la persistance du cache local est requise. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/mnt/data` | Chemin du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |

### Groupe 19 — Paramètres de l'application Crawl4AI {#group-19--crawl4ai-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `redis_task_ttl_seconds` | `3600` | TTL en secondes pour les résultats de tâche dans Redis intégré. Plage valide : 300–86400. Trop court, les résultats expirent avant que les clients ne les interrogent ; trop long, cela entraîne une croissance illimitée de la mémoire Redis. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Crawl4AI. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms de tous les jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `memory_limit` (dans `container_resources`) | `8Gi` | Critique | En dessous de 4 Gio, les processus Chromium sont tués par OOM en plein crawl, renvoyant des résultats partiels ; en dessous de 2 Gio, le conteneur ne démarre pas. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires (`32Gi`) | Critique | Les entiers bruts sont lus comme des octets par Kubernetes et bloquent toute planification de pod. |
| `REDIS_HOST` / `REDIS_PORT` (variables d'environnement) | ne pas définir | Critique | Surcharger ces valeurs rompt la connexion Redis intégrée ; tous les jobs d'exploration asynchrone échouent immédiatement. |
| `database_type` | `NONE` | Critique | Crawl4AI n'a pas de base de données ; modifier cela entraîne un provisionnement Cloud SQL inutile et un échec de démarrage. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro (`0`) entraîne des démarrages à froid de 30 à 60 s (supervisord doit démarrer Redis puis Gunicorn) ; la première requête expire généralement. |
| `cpu_limit` (dans `container_resources`) | `4` | Élevé | En dessous de 2 vCPU, le rendu JavaScript de Chromium déclenche des timeouts internes sur les pages complexes, ralentissant considérablement le débit d'exploration. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | Sans IAP ou un jeton d'API d'exploration, l'IP de l'équilibreur de charge est accessible publiquement et n'importe qui peut soumettre des jobs d'exploration. |
| `LLM_API_KEY` / clés API du fournisseur | via `secret_environment_variables` | Élevé | Des clés manquantes ou expirées entraînent l'échec silencieux de l'extraction basée sur LLM (`extracted_content` vide). Injecter comme secrets, pas comme variables d'environnement en texte clair. |
| `redis_task_ttl_seconds` | `3600` | Moyen | Trop court (< 300 s) entraîne l'expiration des résultats avant que les clients asynchrones ne les interrogent ; trop long entraîne une croissance illimitée de la mémoire Redis. |
| `session_affinity` | `None` | Moyen | Définir à `ClientIP` lie les clients à un seul pod et rompt la distribution de charge sans aider au routage des tâches (les ID de tâche sont déjà locaux au pod). |
| `application_version` | tag épinglé | Moyen | L'utilisation de `"latest"` n'est pas reproductible ; une reconstruction peut entraîner un changement d'API Crawl4AI incompatible. |
| `enable_image_mirroring` | `true` | Faible | Les images Crawl4AI sont volumineuses ; sans mise en miroir, chaque démarrage de pod tire de Docker Hub et risque des échecs de limite de débit. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application partagée spécifique à
Crawl4AI est décrite dans **[Crawl4AI_Common](Crawl4AI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Crawl4AI sur GKE Autopilot](../labs/Crawl4AI_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Crawl4AI Common — Configuration d'application partagée](Crawl4AI_Common.md) — la configuration partagée par les deux cibles de déploiement.
