---
title: "LiteLLM sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de LiteLLM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LiteLLM_GKE.md @ e69407af sha256:6f06324adafe -->

# LiteLLM sur GKE Autopilot {#litellm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LiteLLM_GKE.png" alt="LiteLLM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LiteLLM est un proxy LLM open source et une passerelle IA qui fournit une API
unifiée compatible OpenAI pour plus de 100 fournisseurs, y compris OpenAI,
Anthropic, Google Gemini, Azure OpenAI, AWS Bedrock et Ollama. Les
organisations l'utilisent pour centraliser le suivi des dépenses IA, gérer les
clés API virtuelles, appliquer des limites de débit et obtenir une visibilité
complète sur l'utilisation des modèles. Ce module déploie LiteLLM sur **GKE
Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par LiteLLM et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Coût de LiteLLM sur RAD et comparaison {#what-litellm-costs-on-rad-and-how-that-compares}

**Le module LiteLLM sur GKE Autopilot de RAD coûte environ 129 $ US par mois
dans votre propre projet, sans facturation par requête.** RAD facture 110
crédits une fois par déploiement dans votre propre projet (99 crédits, soit 10 %
de moins, dans un projet géré par RAD), plus le temps de build. La même
application se déploie également sur Cloud Run pour environ 77 $ US par mois —
voir le [guide Cloud Run](LiteLLM_CloudRun.md) pour l'option la moins chère. Si
vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être
supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce
chiffre mensuel devient quelques dollars au lieu de cela — voir **Mettez-le en
pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **129 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **107 crédits par jour**, soit environ 3 210 par mois (environ 321,00 $ US au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un
abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur
de fichiers et le réseau sont partagés par toutes les applications du projet,
donc une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 Gio | 72 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ US si c'est votre seul cluster, sinon ~73 $ US |
| **Total** | **environ 129 $ US** |

### Comparaison {#how-it-compares}

- **Portkey**, une passerelle LLM hébergée offrant un ensemble de
  fonctionnalités similaires d'API unifiée/suivi des coûts, coûte **49 $ US par
  mois sur son plan Production**, couvrant 100 000 requêtes enregistrées par
  mois, avec une utilisation au-delà facturée par tranches de 9 $ US par 100 000
  requêtes.
- Le module LiteLLM de RAD coûte environ 129 $ US par mois dans votre propre
  projet — plus que Portkey à faible volume, mais il n'y a pas de facturation
  par requête, et chaque invite, réponse et clé API de fournisseur reste dans
  l'infrastructure que vous contrôlez plutôt que de passer par la passerelle
  d'un tiers.
- Comparaison auto-gérée : son pod GKE de 2 vCPU / 2 Gio est plus proche d'un
  GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, ~49 $/mois) — mais vous devez
  alors gérer PostgreSQL, les correctifs de sécurité et la disponibilité de la
  passerelle vous-même ; Cloud SQL géré par RAD, Secret Manager et la
  surveillance couvrent cela.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si LiteLLM s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
tout le projet et restaurez-le dans les 30 jours pour presque rien.** Cela
convient bien mieux à LiteLLM dont vous n'avez besoin qu'occasionnellement —
évaluation, environnement de démonstration, charge de travail saisonnière ou
intermittente — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un seul module, cela ne
  détruit pas la base de données, aucune VM ou la ressource de calcul une par
  une — tout le projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de restaurer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer
  que tout est revenu. Comme rien n'a été détruit individuellement, cette mise
  à jour trouve les mêmes ressources déjà présentes — c'est une vérification,
  pas une reconstruction, et une mise à jour ne facture jamais les frais de
  module à nouveau. Pour LiteLLM derrière Services_GCP (un cluster GKE, une
  base de données Postgres) et Project_GCP, cela représente environ **une
  poignée de crédits (moins de 1 $ US)** au total, contre environ 115 crédits
  (11,50 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 129 $ US.** Déployez LiteLLM, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez
  terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  le temps pendant lequel il a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont
  RAD gère uniquement la facturation), et vous le restaurez vous-même dans les
  30 jours — après cela, Google le supprime définitivement. La restauration est
  admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du palier (100 crédits pour le palier
  sandbox que la plupart des utilisations d'évaluation conviennent). Google
  indique que la plupart des services sont de nouveau pleinement fonctionnels
  dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes et autres fichiers générés sont écrits dans un bucket à
  l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression
  logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès
  que vous supprimez le projet — même si le projet lui-même est récupérable
  pendant 30 jours. Si vous avez personnalisé LiteLLM et que vous souhaitez
  conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket
  extérieur au projet) avant de supprimer. Pour une installation par défaut
  sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les
  builds — environ 115 crédits (11,50 $ US) au total. La suppression permet
  d'économiser de l'argent seulement si LiteLLM resterait inutilisé assez
  longtemps pour compenser ce coût de redéploiement par rapport à son propre
  coût d'exécution — environ **3 jours ou plus**, à la fois dans votre propre
  projet (environ 4,31 $ US par jour) et dans un projet géré par RAD (107
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour
  LiteLLM, il s'agit de la base de données. Ils ne s'arrêtent que si rien
  d'autre dans le projet ne les utilise, donc la suppression de cette
  application alors que quelque chose d'autre partage le projet n'économise que
  la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
  copiez la dernière sauvegarde avant de la supprimer si vous voulez la
  conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre
  projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin de
  la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, afin que
  personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits journaliers de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud
Storage sans suppression logicielle ; [Portkey](https://portkey.ai/pricing).
Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

LiteLLM s'exécute comme une charge de travail de proxy basée sur Python. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods proxy Python, 2 vCPU / 2 Gio par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — l'ORM Prisma de LiteLLM utilise PostgreSQL pour les clés virtuelles et le suivi des dépenses |
| Stockage d'objets | Cloud Storage | Facultatif — aucun bucket créé par défaut |
| Cache | Redis | Facultatif — réduit la latence et le coût des requêtes LLM identiques répétées |
| Secrets | Secret Manager | Clé principale et clé de sel auto-générées ; clés API du fournisseur LLM injectées au moment de l'exécution |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma de LiteLLM nécessite
  PostgreSQL pour la gestion des clés virtuelles et le suivi des dépenses ;
  changer le moteur empêche le démarrage.
- **Une image de conteneur personnalisée est construite par Cloud Build.**
  L'image intègre un `entrypoint.sh` qui assemble `DATABASE_URL` à partir des
  variables d'environnement `DB_*` injectées par la fondation au moment de
  l'exécution.
- **`LITELLM_MASTER_KEY` et `LITELLM_SALT_KEY` sont auto-générées** et stockées dans
  Secret Manager. La clé de sel ne doit jamais être renouvelée après l'émission
  de clés virtuelles — toutes les clés virtuelles existantes deviendraient
  définitivement invalides.
- **`STORE_MODEL_IN_DB = "true"` est défini automatiquement**, permettant la gestion des
  modèles d'exécution et l'interface d'administration sans redémarrage du
  conteneur.
- **Redis est désactivé par défaut.** Activez-le pour les déploiements
  multi-réplicas afin de partager les compteurs de limite de débit et les
  caches de réponse entre les pods.
- **La sonde de démarrage cible `/health/readiness`**, qui valide la connectivité de
  la base de données et confirme que les migrations Prisma sont terminées avant
  que le trafic ne soit acheminé vers le pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de
noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail LiteLLM {#a-gke-autopilot--the-litellm-workload}

Les pods LiteLLM sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail LiteLLM pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LiteLLM stocke toutes les clés virtuelles, les journaux d'utilisation, les
enregistrements de coûts et les règles de routage des modèles dans une instance
Cloud SQL pour PostgreSQL 15 gérée. Les pods l'atteignent en privé via le
sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune IP
publique n'est exposée. Lors du premier déploiement, un job d'initialisation
crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket de stockage n'est créé par défaut. Les buckets peuvent être
déclarés via la variable `storage_buckets` et montés via GCS Fuse lorsque
`gcs_volumes` est défini — par exemple, pour livrer un `config.yaml` au
conteneur sans reconstruire l'image.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/
  ```

Voir [App_GKE](App_GKE.md) pour les options GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache des réponses facultative de LiteLLM et
les compteurs de limite de débit partagés. Lorsque `enable_redis = true`, les
variables d'environnement `REDIS_HOST`, `REDIS_PORT` et
(facultativement) `REDIS_PASSWORD` sont injectées automatiquement dans les pods.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

`LITELLM_MASTER_KEY` (la clé API d'administration principale, préfixée
`sk-`) et `LITELLM_SALT_KEY` (utilisée pour hacher les clés
virtuelles) sont générées automatiquement et stockées dans Secret Manager. Les
clés API du fournisseur LLM (par exemple `OPENAI_API_KEY`) sont injectées en
référençant des secrets préexistants via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master key:
  gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des tests de disponibilité et des politiques
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LiteLLM {#3-litellm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation crée la base de données et l'utilisateur LiteLLM et accorde
  les privilèges avant le démarrage de l'application. Il se connecte à Cloud
  SQL via le proxy d'authentification et est idempotent.
- **Migrations Prisma au démarrage.** LiteLLM exécute ses migrations ORM Prisma
  à chaque démarrage de pod, de sorte que la mise à niveau de la version de
  l'application applique automatiquement les modifications de schéma. La sonde
  de démarrage attend que `/health/readiness` renvoie 200, confirmant que les
  migrations sont terminées avant d'acheminer le trafic vers le pod.
- **Interface d'administration.** L'interface d'administration LiteLLM est
  disponible à l'adresse `/ui` sur l'URL du service.
  Authentifiez-vous avec la clé `LITELLM_MASTER_KEY` (récupérez-la depuis Secret
  Manager). Depuis l'interface utilisateur, vous pouvez ajouter des modèles,
  créer des clés virtuelles, définir des budgets et afficher des tableaux de
  bord d'utilisation — le tout sans redémarrer le conteneur.
- **Ajout de clés de fournisseur LLM.** Les clés API du fournisseur ne sont pas
  gérées par ce module. Fournissez-les au moment du déploiement via
  `secret_environment_variables` (mappant chaque variable d'environnement à un secret
  Secret Manager préexistant), ou ajoutez-les après le déploiement via
  l'interface d'administration ou le point de terminaison API
  `/model/new` en utilisant la clé principale.
- **Gestion des clés virtuelles.** Utilisez l'API `/key/generate` avec la clé
  principale pour émettre des clés virtuelles par équipe ou par utilisateur
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
- **Points de terminaison de santé.** `/health/readiness` valide la connectivité de
  la base de données et l'achèvement de la migration Prisma ;
  `/health/liveliness` confirme que le processus proxy est en cours d'exécution.
  Ceux-ci sont utilisés respectivement comme sondes de démarrage et de vivacité.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
LiteLLM sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `litellm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `LiteLLM AI Gateway` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `main-stable` | Balise de version de l'image LiteLLM ; épingler à une version spécifique pour la stabilité en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Mémoire par pod ; augmenter à `4Gi` pour les déploiements à haut débit. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour éviter les démarrages à froid sur la passerelle API. |
| `max_instance_count` | `3` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `4000` | Port natif de LiteLLM. |
| `timeout_seconds` | `600` | Délai d'expiration de la requête ; augmenter pour les appels d'inférence LLM de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions de socket Unix. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources (désactive HPA). |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Paramètres supplémentaires non secrets. Les variables LiteLLM de base sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de var d'env → nom de secret Secret Manager. Utiliser pour injecter les clés API du fournisseur LLM. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant ; utile lorsqu'un client réutilise une connexion ouverte au même pod. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `["nfsserver"]` | Balises de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC ; sélectionne automatiquement le type de charge de travail StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Déclaré pour la parité des conventions ; non référencé par le déploiement de ce module (aucun ResourceQuota n'est créé). |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Non référencé par ce module. S'il est câblé via un autre module, doit utiliser des unités binaires (`4Gi`, `8192Mi`) — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/health/readiness` | Sonde HTTP ; valide la connectivité de la base de données et les migrations Prisma avant d'acheminer le trafic. |
| `liveness_probe` | `/health/liveliness` | Sonde HTTP ; confirme que le processus proxy est en cours d'exécution. |
| `uptime_check_config` | désactivé | Test de disponibilité facultatif de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré de LiteLLM_Common. |
| `cron_jobs` | `[]` | Kubernetes CronJobs planifiés pour les tâches de maintenance ou de nettoyage. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas requis pour LiteLLM ; activer uniquement pour la livraison de fichiers de configuration partagés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Aucun bucket créé par défaut. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse pour la livraison de fichiers de configuration. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — ne pas modifier ; LiteLLM nécessite PostgreSQL 15. |
| `db_name` | `litellm_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `litellm_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner le routage de l'API Gateway pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant LiteLLM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour la mise en cache des réponses et les compteurs de limite de débit partagés. |
| `redis_host` | `""` | Point de terminaison Redis ; requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre LiteLLM. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` / `POSTGRES_15` | Critique | LiteLLM nécessite PostgreSQL ; changer le moteur rompt l'ORM Prisma et empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Le sidecar Auth Proxy est requis pour la connectivité de la base de données ; le désactiver entraîne l'échec de Prisma au démarrage. |
| `LITELLM_SALT_KEY` | auto-généré, jamais renouvelé | Critique | Le renouvellement de la clé de sel invalide toutes les clés virtuelles précédemment émises ; tous les consommateurs d'API perdent l'accès immédiatement. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les clés virtuelles et les données de dépenses. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `ingress_settings` / `service_type` | restreindre pour la production | Critique | Un équilibreur de charge public expose le point de terminaison de la clé principale ; utiliser `ClusterIP` avec une passerelle authentifiée pour les déploiements internes. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | fournir lorsque l'IAP est activé | Critique | Les valeurs manquantes empêchent l'initialisation de la passerelle IAP et rendent le service inaccessible. |
| `LITELLM_MASTER_KEY` | auto-généré | Élevé | Traiter comme une information d'identification ; le renouveler rompt toutes les intégrations existantes détenant la clé jusqu'à ce qu'elles soient mises à jour. |
| `enable_redis` | `true` pour multi-réplica | Élevé | Sans Redis, les compteurs de limite de débit sont par pod et non partagés ; les quotas ne sont pas appliqués sur les réplicas. |
| `redis_host` | défini lorsque Redis est activé | Élevé | Un hôte vide avec `enable_redis = true` provoque des erreurs de connexion à chaque requête. |
| `min_instance_count` | `1` | Élevé | Les démarrages à froid ajoutent une latence de 30 à 60 s et mettent en file d'attente tous les services dépendants. |
| `timeout_seconds` | `600` | Élevé | L'inférence de grands modèles linguistiques peut prendre des minutes ; un délai d'expiration trop court provoque des erreurs 504 sur les modèles lents. |
| `application_version` | épingler pour la production | Moyen | LiteLLM publie fréquemment ; les versions non épinglées peuvent modifier le schéma Prisma ou rompre les formats de clés virtuelles. |
| `enable_vertical_pod_autoscaling` | `false` sauf si VPA est utilisé | Moyen | L'activation de VPA désactive HPA ; choisissez l'un ou l'autre. |
| `NUM_WORKERS` | `1` (augmenter pour le débit) | Moyen | Un seul worker sérialise toutes les requêtes ; augmenter à 2-4 et mettre à l'échelle `cpu_limit` proportionnellement pour les passerelles à fort trafic. |
| `backup_schedule` | `0 2 * * *` | Élevé | Sans sauvegardes, une suppression accidentelle détruit toutes les clés virtuelles et l'historique d'utilisation sans chemin de récupération. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à LiteLLM
partagée avec la variante Cloud Run est décrite dans
**[LiteLLM_Common](LiteLLM_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : LiteLLM sur GKE Autopilot](../labs/LiteLLM_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LiteLLM Common — Configuration d'application partagée](LiteLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
