---
title: "N8N AI sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de N8N AI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/N8N_AI_GKE.md @ 1665a43e sha256:c5e7e5aa333a -->

# N8N AI sur GKE Autopilot {#n8n-ai-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_AI_GKE.png" alt="N8N AI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme open source d'automatisation de flux de travail avec une interface
visuelle basée sur des nœuds pour connecter des services, exécuter de la logique et créer des
pipelines basés sur l'IA. Ce module déploie n8n sur **GKE Autopilot** avec deux services
d'IA complémentaires — **Qdrant** (base de données vectorielle pour RAG et recherche
sémantique) et **Ollama** (inférence LLM locale pour une IA axée sur la confidentialité) —
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par n8n AI et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie
du déploiement — veuillez-vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte N8N_AI sur RAD, et comment cela se compare {#what-n8n_ai-costs-on-rad-and-how-that-compares}

**L'exécution de N8N_AI dans votre propre projet GCP coûte environ 149,81 $/mois en frais
Google Cloud ; les frais de module de RAD sont de 175 crédits (ou 157,5 crédits dans un
projet géré par RAD), couvrant la configuration et le support — pas la facture cloud
courante, que Google vous facture directement dans votre propre projet ou que RAD facture à
l'heure en crédits dans un projet géré par RAD.** Si un coût d'exécution inférieur est plus
important que la cible de déploiement, consultez le guide Cloud Run pour l'option à moindre
coût ; sinon, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause
gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 175 crédits, une fois | 157,5 crédits, une fois (10 % de moins) |
| Temps de build | facturé en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~149,81 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~116 crédits/jour, facturé à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 Gio | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **149,81 $** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour N8N_AI à comparer, donc la base de
  référence honnête est un VPS nu : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**,
  un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine
  e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur
  pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL,
  Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes monétaires, et ne l'est
  généralement pas — pour une pile d'automatisation IA axée sur la confidentialité (flux de
  travail + recherche vectorielle + service LLM local), le véritable argument est ce que RAD
  gère pour vous (sauvegardes, correctifs, secrets, surveillance) plutôt que le prix affiché.
- Dans tous les cas, il s'agit d'une pile d'automatisation IA axée sur la confidentialité
  (flux de travail + recherche vectorielle + service LLM local), donc le coût d'exécution
  ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût
  d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la
suppression d'un module, cela ne démantèle pas Cloud SQL, aucune VM ou la ressource de
calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant
qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande
d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Étant
donné que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à
jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de
crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3
déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après quoi
Google le supprime définitivement — et la restauration est admise comme la création d'un
nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du
niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo
correspondent). Google indique que la plupart des services sont à nouveau pleinement
opérationnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez
le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé l'application et que vous souhaitez conserver ce travail, copiez une
sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour
une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30
jours ci-dessus), l'alternative est de supprimer N8N_AI purement et simplement et de le
redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds
— environ 175 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si N8N_AI resterait inutilisé
suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre
coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente
environ 4 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base
de données et la VM de fichier/cache partagée ; elles ne s'arrêtent que si rien d'autre dans
le projet ne les utilise, donc la suppression de cette application pendant que quelque chose
d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à
l'intérieur du déploiement et sont supprimées avec celui-ci, donc copiez la dernière
sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe.
  Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle
  directement avec le client. Si le portefeuille est faible, la facturation est suspendue et
  les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la
  fin, le partenaire transfère le projet et les déploiements deviennent la propriété du
  client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES
  et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ;
radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens
; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes
de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

N8N AI s'exécute comme une charge de travail de flux de travail Node.js aux côtés des
déploiements Kubernetes de Qdrant et Ollama. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiements n8n + Qdrant + Ollama, 2 vCPU / 4 Gio par défaut pour n8n |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — n8n nécessite PostgreSQL ; le moteur est fixe |
| Stockage d'objets | Cloud Storage (GCS Fuse) | Bucket de données AI partagé monté à `/mnt/gcs` ; données de flux de travail à `/home/node/.n8n` |
| Fichiers partagés | Filestore (NFS) | Volume NFS partagé pour la persistance multi-réplique ; sert également d'hôte Redis par défaut |
| Cache et file d'attente | Redis | Activé par défaut ; utilisé pour le mode file d'attente n8n sur plusieurs répliques |
| Base de données vectorielle | Qdrant (intra-cluster) | Déployé comme un déploiement Kubernetes compagnon ; service ClusterIP interne uniquement |
| Inférence LLM | Ollama (intra-cluster) | Déployé comme un déploiement Kubernetes compagnon ; service ClusterIP interne uniquement |
| Secrets | Secret Manager | `N8N_ENCRYPTION_KEY` et `N8N_SMTP_PASS` auto-générés ; synchronisés avec les secrets Kubernetes |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré via l'API Gateway |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  configuration commune ; la modification de `database_type` en MySQL interrompt le démarrage.
- **`N8N_ENCRYPTION_KEY` est auto-généré** et stocké dans Secret Manager. Sauvegardez-le avant de
  détruire le module — les identifiants chiffrés avec une clé ne peuvent pas être déchiffrés
  avec une clé différente.
- **Qdrant et Ollama s'exécutent en tant que déploiements Kubernetes internes uniquement**
  dans le même espace de noms que n8n, chacun avec un service ClusterIP. Ils ne sont pas
  exposés en dehors du cluster.
- **La persistance GCS Fuse** maintient l'index vectoriel de Qdrant (`/mnt/gcs/qdrant`) et les poids
  de modèle d'Ollama (`/mnt/gcs/ollama/models`) durables après les redémarrages de pod.
- **Redis est activé par défaut.** Avec plus d'une réplique, un backend de file d'attente
  partagé est requis pour éviter l'exécution de flux de travail en split-brain.
- **`min_instance_count` par défaut à `0`.** GKE HPA ne prend pas en charge la véritable mise à
  l'échelle à zéro de la même manière que Cloud Run ; définissez sur `1` pour une
  disponibilité fiable des webhooks.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail n8n AI {#a-gke-autopilot--the-n8n-ai-workload}

n8n, Qdrant et Ollama s'exécutent chacun comme un déploiement Kubernetes distinct dans le
même espace de noms. L'autoscaling horizontal de pods (HPA) régit le nombre de répliques n8n
entre les limites minimale et maximale. Qdrant et Ollama sont fixés à une réplique chacun.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez chaque charge de
  travail pour voir les pods, les révisions et les événements. Kubernetes Engine → Services
  et Ingress affiche les adresses IP externes et les points de terminaison ClusterIP.
- **CLI :**
  ```bash
  kubectl get deployments,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/n8nai --tail=100
  kubectl logs -n "$NAMESPACE" deploy/qdrant --tail=50
  kubectl logs -n "$NAMESPACE" deploy/ollama --tail=50
  kubectl describe hpa -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur Autopilot, la mise à l'échelle et les types
de charges de travail.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de flux de travail, l'historique d'exécution et les
identifiants dans une instance gérée de Cloud SQL pour PostgreSQL 15. Les pods y accèdent
privatement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix à `127.0.0.1`. Lors du
premier déploiement, un job `db-init` crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage (GCS Fuse) et Filestore (NFS) {#c-cloud-storage-gcs-fuse-and-filestore-nfs}

Un bucket **Cloud Storage** partagé est monté dans chaque conteneur via GCS Fuse :

- Données de flux de travail et identifiants n8n à `/home/node/.n8n`
- Index vectoriel de Qdrant à `/mnt/gcs/qdrant`
- Poids de modèle d'Ollama à `/mnt/gcs/ollama/models`

**Filestore (NFS)** est activé par défaut et fournit un volume persistant partagé pour les
données multi-répliques et sert également de point de terminaison Redis par défaut.

- **Console :** Cloud Storage → Buckets pour le bucket de données AI ; Filestore → Instances
  pour le partage NFS.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<ai-data-bucket>/          # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- df -h | grep -E "gcs|nfs"
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Backend de file d'attente Redis {#d-redis-queue-backend}

Redis prend en charge le mode file d'attente de n8n, permettant une exécution fiable des
flux de travail multi-répliques. Lorsqu'aucun `redis_host` n'est configuré et que NFS est
activé, l'adresse IP du serveur NFS est utilisée comme point de terminaison Redis. Pour la
production avec haute disponibilité, pointez vers une instance Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep -E "REDIS"
  redis-cli -h <redis-host> ping
  ```

### E. Qdrant — base de données vectorielle {#e-qdrant--vector-database}

Qdrant offre une recherche de similarité vectorielle haute performance pour les pipelines
RAG, les embeddings de documents et la mémoire AI dans les flux de travail n8n. Il est
déployé en tant que déploiement Kubernetes interne uniquement et est accessible depuis n8n
via la variable d'environnement `QDRANT_URL`, qui pointe vers son service ClusterIP.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez le déploiement
  `qdrant`.
- **CLI :**
  ```bash
  kubectl get deployment qdrant -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/qdrant --tail=50
  # Confirm QDRANT_URL is injected into n8n
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep QDRANT_URL
  # Check Qdrant's health endpoint from inside the cluster
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- curl -s http://qdrant:6333/healthz
  ```

### F. Ollama — serveur LLM local {#f-ollama--local-llm-server}

Ollama exécute des modèles de langage open source (Llama 3, Mistral, Gemma) directement sur
votre infrastructure, permettant une inférence IA axée sur la confidentialité sans
dépendances API externes. Il s'agit d'un déploiement Kubernetes interne uniquement ;
`OLLAMA_HOST` est injecté dans n8n pour l'atteindre.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez le déploiement
  `ollama`.
- **CLI :**
  ```bash
  kubectl get deployment ollama -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/ollama --tail=50
  # Confirm OLLAMA_HOST is injected into n8n
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep OLLAMA_HOST
  # List models loaded in Ollama (from inside the cluster)
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- curl -s http://ollama:11434/api/tags
  ```

### G. Secret Manager {#g-secret-manager}

La clé de chiffrement n8n et le mot de passe SMTP sont générés automatiquement et stockés
en tant que secrets Secret Manager, puis synchronisés avec les secrets Kubernetes et injectés
dans les pods au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### H. Réseau et ingress {#h-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load
Balancing. La prise en charge de domaines personnalisés via l'API Kubernetes Gateway avec un
certificat géré par Google est activée par défaut (`enable_custom_domain = true`), et une adresse IP
statique est réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get gateway,httproute,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et l'adresse IP
statique.

### I. Cloud Logging et Monitoring {#i-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE
et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et
des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application N8N AI {#3-n8n-ai-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job Kubernetes
  `db-init` s'exécute avant le démarrage du déploiement n8n. Il crée la base de données
  PostgreSQL `n8n_db` et l'utilisateur `n8n_user` via le socket Cloud SQL Auth Proxy,
  accorde tous les privilèges et arrête proprement le proxy. Le job est idempotent et peut
  être réexécuté en toute sécurité.
- **Clé de chiffrement.** `N8N_ENCRYPTION_KEY` est auto-généré lors du premier déploiement et
  stocké dans Secret Manager. **Sauvegardez ce secret avant de détruire le module.** Tous
  les identifiants n8n (clés API, jetons OAuth, mots de passe de flux de travail) sont
  chiffrés avec cette clé ; ils ne peuvent pas être déchiffrés après un redéploiement avec
  une clé différente.
- **Sondes de santé.** La sonde de démarrage cible `GET /` sur le port 5678 avec un
  délai initial de 120 secondes, donnant à n8n le temps de se connecter à PostgreSQL et de
  charger l'état du flux de travail. La sonde de vivacité vérifie le même chemin après le
  démarrage.
- **URL de webhook et d'éditeur.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définis sur
  l'URL de service prédite avant la création du déploiement afin que les webhooks
  fonctionnent sans réapplication post-déploiement.
- **Mode file d'attente.** Lorsque Redis est activé, n8n fonctionne en mode file d'attente
  pour une exécution fiable des flux de travail sur plusieurs répliques. Sans Redis, une
  seule réplique doit s'exécuter.
- **Mot de passe SMTP.** `N8N_SMTP_PASS` est auto-généré comme un espace réservé. Remplacez la
  valeur secrète dans Secret Manager par de véritables identifiants SMTP avant d'activer
  l'envoi d'e-mails.
- **Inspecter les jobs planifiés et les CronJobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl get cronjobs -n "$NAMESPACE"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour n8n AI sont listés ; toutes
les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et
ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `n8nai` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `N8N AI Starter Kit` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod n8n ; également hérité par Ollama. 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par pod n8n ; également hérité par Ollama. 4 Gio minimum pour les charges de travail AI. |
| `min_instance_count` | `0` | Répliques n8n minimales. Définir sur `1` pour une disponibilité continue des webhooks. |
| `max_instance_count` | `3` | Répliques maximales. Augmenter uniquement avec Redis activé. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter pour les longs flux de travail d'inférence AI. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Espaces réservés SMTP | Paramètres non sensibles. Les variables n8n principales sont injectées automatiquement ; ne pas définir `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `QDRANT_URL` ou `OLLAMA_HOST`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utiliser pour les clés API de fournisseurs AI externes. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager (30 jours). Configure une notification Pub/Sub lorsque la rotation est due. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `None` | n8n AI est sans état entre les instances avec Redis. Changer en `ClientIP` uniquement si nécessaire. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Requis pour les règles de pare-feu de connectivité NFS. |
| `gke_cluster_name` | `""` | Laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Laisser vide pour générer automatiquement. |
| `prereq_subnet_cidr_override` | `""` | Remplacer pour le sous-réseau primaire VPC inline CIDR. Vide dérive un /24 unique par déploiement à partir de l'ID de déploiement aléatoire ; définir sur la valeur précédemment appliquée sur les déploiements existants pour éviter le remplacement des ressources. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC dans le StatefulSet. La définition de `true` sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont traités comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods n8n, Qdrant et Ollama sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` — délai de 120s | Sonde de démarrage n8n ; un délai généreux permet la connexion à la base de données + le chargement du flux de travail. |
| `liveness_probe` | HTTP `/` — délai de 30s | Sonde de vivacité n8n. |
| `startup_probe_config` | TCP — activé | Sonde de démarrage standard App_GKE. |
| `health_check_config` | HTTP `/` — activé | Sonde de vivacité standard App_GKE. |
| `uptime_check_config` | désactivé | Activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs planifiés pour les tâches périodiques (exportations, maintenance). |
| `additional_services` | `[]` | Déploiements sidecar ou auxiliaires supplémentaires à côté de n8n. |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données de flux de travail et la découverte de l'hôte Redis par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. Remplacer lors du montage d'un deuxième partage NFS à côté du premier. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets GCS. |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de données AI auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Backend de file d'attente Redis {#group-15--redis-queue-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le mode file d'attente n8n. **Requis lorsque `max_instance_count > 1`.** |
| `redis_host` | `""` | Laisser vide pour utiliser l'adresse IP du serveur NFS ; définir explicitement pour une instance Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `n8n_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_mysql_plugins` | `false` | Activer l'installation automatique des plugins MySQL. Applicable uniquement aux bases de données MySQL ; `N8N_AI_Common` fixe `database_type` à PostgreSQL 15, donc ceci est inerte pour la propre base de données de n8n. |
| `mysql_plugins` | `[]` | Liste des plugins MySQL à installer (par exemple `validate_password`, `audit_log`). Applicable uniquement aux bases de données MySQL. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'API Kubernetes Gateway pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy sensible à l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant n8n. **Note :** l'activation d'IAP bloque les points de terminaison de webhook publics. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Niveaux d'accès CIDR / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe — Composants AI {#group--ai-components}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_ai_components` | `true` | Commutateur principal. Définir `false` pour déployer n8n sans Qdrant ni Ollama. |
| `enable_qdrant` | `true` | Déployer Qdrant en tant que déploiement Kubernetes interne uniquement. |
| `qdrant_version` | `latest` | Tag d'image Docker Qdrant. Épingler à une version spécifique pour la stabilité de la production. |
| `enable_ollama` | `true` | Déployer Ollama en tant que déploiement Kubernetes interne uniquement. |
| `ollama_version` | `latest` | Tag d'image Docker Ollama. Épingler à une version spécifique pour la stabilité de la production. |
| `ollama_model` | `llama3.2` | Déclaration de modèle par défaut. Remarque : cette variable n'est actuellement pas transmise au service Ollama — les modèles doivent être extraits séparément au niveau de l'API Ollama. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes pour la charge de travail n8n. |
| `namespace` | Espace de noms dans lequel toutes les charges de travail (n8n, Qdrant, Ollama) s'exécutent. |
| `service_cluster_ip` | ClusterIP intra-cluster pour le service n8n. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre l'interface utilisateur de n8n. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (`n8n_db`). |
| `database_user` | Utilisateur de la base de données de l'application (`n8n_user`). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de données AI). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` (auto-généré) | Sauvegarder immédiatement | Critique | Toute modification après la première exécution détruit définitivement toutes les informations d'identification n8n enregistrées. |
| `application_name` | `n8nai` — défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée toutes les ressources GCP et Kubernetes avec perte de données. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage pointe n8n vers une nouvelle base de données vide, perdant tous les workflows. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `enable_qdrant` | `true` | Élevé | Les workflows RAG actifs échouent à l'exécution avec des erreurs de connexion si Qdrant est supprimé. |
| `enable_ollama` | `true` | Élevé | Les workflows utilisant le nœud LLM local échouent ; ne désactiver que lors de l'utilisation exclusive de fournisseurs d'IA externes. |
| `enable_redis` | `true` | Élevé | Sans Redis, plusieurs réplicas entrent en conflit sur l'état du workflow ; l'exécution en split-brain corrompt les exécutions. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais que `redis_host` et NFS ne sont pas définis, n8n ne démarre pas. |
| `memory_limit` | `4Gi` | Élevé | Les workflows d'IA (intégration, recherche vectorielle, chaînage LLM) provoquent des OOM kills en dessous de 4 GiB. |
| `max_instance_count` | `1` sauf si Redis est configuré | Élevé | La mise à l'échelle au-delà de 1 sans Redis provoque un split-brain ; l'augmentation avec Redis est sûre. |
| `min_instance_count` | `1` pour les webhooks | Moyen | `0` peut laisser les webhooks sans pod cible ; l'état HPA peut être incohérent sur GKE. |
| `enable_nfs` | `true` | Élevé | Qdrant et Ollama utilisent GCS Fuse sur le bucket de données AI ; sans cela, les fichiers de modèle et les index vectoriels sont perdus au redémarrage du pod. |
| `enable_iap` | uniquement avec des identifiants OAuth valides | Élevé | L'activation sans `iap_oauth_client_id` / `iap_oauth_client_secret` bloque tout accès. IAP bloque également les webhooks publics. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes,
et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à n8n AI
partagée avec la variante Cloud Run est décrite dans
**[N8N_AI_Common](N8N_AI_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : N8N_AI sur GKE Autopilot](../labs/N8N_AI_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [N8N AI sur Cloud Run](N8N_AI_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [N8N AI Common — Configuration d'application partagée](N8N_AI_Common.md) — la configuration partagée par les deux cibles de déploiement.
