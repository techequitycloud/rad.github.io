---
title: "Open WebUI sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Open WebUI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenWebUI_GKE.md @ e69407af sha256:9178c97215de -->

# Open WebUI sur GKE Autopilot {#open-webui-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenWebUI_GKE.png" alt="Open WebUI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Open WebUI est une interface d'IA auto-hébergée offrant un frontal soigné de style
ChatGPT pour Ollama, les API compatibles OpenAI et des dizaines d'autres
fournisseurs de LLM. Ce module déploie Open WebUI sur **GKE Autopilot**
sur la base du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Open WebUI et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Coût d'OpenWebUI sur RAD et comparaison {#what-openwebui-costs-on-rad-and-how-that-compares}

**Pour une petite équipe, OpenWebUI sur le module GKE Autopilot de RAD coûte environ 150 $ US par mois, sans licence par utilisateur.** GKE convient à un Open WebUI qui doit rester opérationnel, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes. Pour un coût minimal, le [module Cloud Run](OpenWebUI_CloudRun.md) exécute le même OpenWebUI pour environ 102 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ces 150 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **116 crédits par jour**, soit environ 3 480 crédits par mois (environ 348 $ US au prix de la recharge, 278 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 150 $ US**, ou environ 223 $ US sans le niveau gratuit |

- Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, il ne s'applique donc que si c'est votre seul cluster de ce type. Cloud SQL coûte le même prix en africa-south1 (Johannesburg) ; le pod et la VM coûtent environ 10 % de plus là-bas.
- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod OpenWebUI est toujours en cours d'exécution, de sorte que le coût ci-dessus est le même, que quelqu'un l'utilise ou non ; des pods supplémentaires ne sont ajoutés que sous charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comparaison {#how-it-compares}

- Il n'existe pas de "Open WebUI Cloud" officiel avec des prix publics — le projet est livré en tant que logiciel auto-hébergé — cette comparaison se fait donc par rapport à un serveur nu.
- Un VPS nu dimensionné près de l'empreinte 2 vCPU / 4 GiB d'Open WebUI — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois — est moins cher en espèces que l'un ou l'autre des chiffres RAD ci-dessus.
- Le Cloud SQL géré par RAD (historique de chat, comptes) et Secret Manager (les clés API pour les fournisseurs LLM derrière lui) remplacent les sauvegardes, les correctifs et la gestion des secrets que vous feriez autrement vous-même sur un VPS.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenWebUI s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — préparation d'une certification, environnement de démonstration, activité saisonnière — que l'exécution continue d'OpenWebUI.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, aucune VM ou le cluster GKE un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas un rebuild.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas un rebuild, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les 180 crédits (18 $ US) qu'un redéploiement complet coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 150 $ US.** Déployez OpenWebUI, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps pendant lequel OpenWebUI était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes d'OpenWebUI sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à OpenWebUI que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le workflow de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot ne s'adapte pas à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US), car RAD recrée le projet et les services partagés avant OpenWebUI. La suppression ne permet d'économiser de l'argent que si OpenWebUI devait rester inutilisé pendant environ 4 jours ou plus, à la fois dans votre propre projet (environ 4,99 $ US par jour) et dans un projet géré par RAD (116 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'OpenWebUI pendant que quelque chose d'autre partage le projet n'économise que la partie calcul d'OpenWebUI.
- **Conservez les données en premier.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

Open WebUI s'exécute en tant que charge de travail web Python adossée à PostgreSQL. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods web Python, 2 vCPU / 4 GiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — sessions, conversations et données RAG y résident |
| Fichiers partagés | Filestore (NFS) | Optionnel — nécessaire uniquement lorsque plusieurs réplicas partagent des fichiers téléchargés |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Secrets | Secret Manager | `WEBUI_SECRET_KEY` et mot de passe de base de données auto-générés |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, nom de domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** Open WebUI ne prend pas en charge MySQL ou tout autre moteur ; le type de base de données est fixé en interne.
- **Pas de Redis.** Open WebUI persiste les sessions et tout l'état de l'application dans PostgreSQL. La variable `enable_redis` est par défaut `false` et aucune variable d'environnement Redis n'est injectée.
- **`WEBUI_SECRET_KEY` est auto-généré** et stocké dans Secret Manager. Il signe toutes les sessions utilisateur ; sa rotation invalide simultanément toutes les sessions actives. Traitez-le comme immuable après la première utilisation.
- **Les nouveaux utilisateurs nécessitent une approbation administrative par défaut.** `default_user_role = "pending"` signifie que les comptes auto-enregistrés ne peuvent pas accéder à l'interface utilisateur tant qu'un administrateur ne les a pas promus.
- **`min_instance_count` est par défaut `1`** (un pod chaud, pas de mise à l'échelle à zéro). Définissez-le sur `0` pour permettre la mise à l'échelle à zéro, au prix d'une latence de démarrage à froid de 30 à 60 secondes lors de la première requête (démarrage du pod + proxy Cloud SQL).
- **Les sondes de santé ciblent `/health`.** Open WebUI expose ce chemin nativement ; les sondes de démarrage et de vivacité l'utilisent toutes deux.
- **`DATABASE_URL` est assemblé automatiquement** à partir des identifiants Cloud SQL injectés par la plateforme — ne le surchargez pas.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Open WebUI {#a-gke-autopilot--the-open-webui-workload}

Les pods Open WebUI sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Open WebUI pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Open WebUI stocke toutes les données d'application — comptes utilisateur, conversations, index RAG et embeddings de documents téléchargés — dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** via un socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
    --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (`openwebui-data`) est provisionné automatiquement pour le répertoire de données backend d'Open WebUI. Le compte de service de la charge de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options GCS Fuse et CMEK.

### D. Filestore (NFS) — stockage partagé optionnel {#d-filestore-nfs--optional-shared-storage}

NFS est désactivé par défaut. Activez-le (`enable_nfs = true`) lorsque vous exécutez plusieurs réplicas et que les fichiers téléchargés doivent être visibles sur tous les pods. Sans stockage partagé, un fichier téléchargé sur un pod n'est pas visible par un autre.

- **Console :** Filestore → Instances pour le partage NFS.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour les détails de provisionnement NFS.

### E. Secret Manager {#e-secret-manager}

`WEBUI_SECRET_KEY` (clé de signature de session) et le mot de passe de la base de données sont stockés en tant que secrets Secret Manager et injectés dans les pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration ou les journaux.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Open WebUI {#3-open-webui-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) exécute `postgres:15-alpine` sur l'instance Cloud SQL via le proxy d'authentification. Il crée de manière idempotente la base de données et l'utilisateur de l'application avant le démarrage de l'application.
- **Migrations de base de données au démarrage.** Open WebUI exécute ses propres migrations de schéma Alembic à chaque démarrage, de sorte que la mise à niveau de `application_version` applique automatiquement toutes les nouvelles modifications de schéma. Au premier démarrage, cela peut prendre 30 à 60 secondes.
- **Assemblage de `DATABASE_URL`.** Le point d'entrée personnalisé (`entrypoint.sh`) assemble le `DATABASE_URL` à partir des variables d'environnement `DB_HOST`, `DB_USER`, `DB_PASSWORD` et `DB_NAME` injectées par la plateforme. Le mot de passe est encodé en URL dans le processus. Ne surchargez pas `DATABASE_URL` directement.
- **`WEBUI_SECRET_KEY` est immuable.** La clé signe toutes les sessions utilisateur. La faire pivoter (par exemple en redéployant avec une nouvelle valeur aléatoire) déconnecte immédiatement tous les utilisateurs actifs et invalide tous les jetons de mémorisation. Traitez-la comme permanente après la première connexion.
- **Connexion au backend AI.** Open WebUI se connecte à une instance Ollama ou à une API compatible OpenAI au démarrage. Si ni `ollama_base_url` ni `openai_api_base_url` n'est configuré, l'interface utilisateur démarre mais n'a pas de backend AI — toutes les requêtes d'inférence de modèle échouent. Fournissez les clés API (par exemple `OPENAI_API_KEY`) via `secret_environment_variables`, pas `environment_variables`.
- **Flux d'enregistrement des utilisateurs.** Avec `default_user_role = "pending"` (la valeur par défaut), tous les comptes auto-enregistrés doivent être promus par un administrateur avant de pouvoir utiliser l'interface utilisateur. Le premier compte administrateur doit être créé directement via la page d'inscription au premier démarrage.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/health`, qui renvoie HTTP 200 une fois que l'application et la connexion à la base de données sont prêtes. La sonde de démarrage autorise jusqu'à 300 secondes (30 échecs × période de 10 secondes) pour que la migration du premier démarrage se termine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Open WebUI sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openwebui` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Open WebUI` | Nom convivial affiché dans la Console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Open WebUI. Épinglez à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour les charges de travail RAG. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (les pipelines RAG peuvent utiliser 3 à 6 GiB sous charge). |
| `min_instance_count` | `1` | Réplicas minimum. Définissez `1` pour une utilisation interactive en équipe ; `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `3` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `8080` | Port HTTP d'Open WebUI (correspond au `EXPOSE` de l'image officielle). |
| `timeout_seconds` | `300` | Délai d'expiration de la requête. Augmentez à `600`–`3600` pour les RAG riches en documents ou les backends LLM lents. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — doit être `true` lors de la connexion à Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Open WebUI dans Artifact Registry (évite les limites de débit de GHCR). |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources (désactive HPA si activé). |

### Groupe 5 — Paramètres Open WebUI {#group-5--open-webui-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ollama_base_url` | `""` | URL de base pour le backend Ollama (par exemple `http://ollama:11434`). Laissez vide si vous n'utilisez pas Ollama directement. |
| `openai_api_base_url` | `""` | URL de base pour une API compatible OpenAI (par exemple `https://api.openai.com/v1`). Doit inclure le suffixe `/v1`. |
| `default_user_role` | `pending` | Rôle attribué aux nouveaux comptes auto-enregistrés. `pending` nécessite l'approbation de l'administrateur ; `user` accorde un accès immédiat. |
| `enable_signup` | `true` | Autoriser la page d'inscription. Définissez `false` après la création des comptes administrateur en production. |
| `webui_auth` | `true` | Activer le formulaire de connexion. Ne définissez `false` que pour les déploiements mono-utilisateur ou entièrement isolés. |
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne surchargez pas `DATABASE_URL` ou `WEBUI_SECRET_KEY`. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager. Utilisez pour `OPENAI_API_KEY` et similaires. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant — recommandé pour la cohérence de session d'Open WebUI. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC dans le StatefulSet pour la persistance des données locales aux côtés de PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. Le chemin de montage par défaut est `/app/backend/data`. |
| `stateful_pvc_mount_path` | `/app/backend/data` | Chemin du conteneur où le PVC par pod est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | chemin `/health` | Sonde HTTP vers le point de terminaison de santé d'Open WebUI. Délai initial de 30 s avec 30 échecs autorisés pour les migrations au premier démarrage. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Open WebUI n'a pas de commandes planifiées requises ; ajoutez ici toutes les tâches récurrentes spécifiques à l'application. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé — nécessaire lorsque plusieurs réplicas doivent partager des fichiers téléchargés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse pour des répertoires supplémentaires adossés à des buckets. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `openwebui_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openwebui_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une passerelle pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Open WebUI. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Open WebUI. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnel) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
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
| `enable_cloudsql_volume` | `true` | Critique | La désactivation interrompt toutes les connexions à la base de données lors de l'utilisation de Cloud SQL. Ne désactiver que lors de la connexion à un PostgreSQL externe via TCP. |
| `WEBUI_SECRET_KEY` (auto-généré) | immuable après la première utilisation | Critique | La rotation de la clé déconnecte immédiatement tous les utilisateurs actifs et invalide tous les jetons "se souvenir de moi". |
| `webui_auth` | `true` | Critique | La désactivation supprime le formulaire de connexion — toute personne pouvant atteindre l'URL a un accès administrateur complet sans identifiants. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; toute modification recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `database_type` (fixe) | `POSTGRES_15` | Critique | Open WebUI nécessite PostgreSQL ; tout autre moteur interrompt les migrations et le démarrage. |
| `ollama_base_url` / `openai_api_base_url` | au moins un défini | Élevé | Sans URL de backend, Open WebUI démarre mais toutes les requêtes d'inférence de modèle échouent immédiatement. |
| `default_user_role` | `pending` | Élevé | `user` approuve automatiquement toutes les auto-inscriptions ; sur un service exposé publiquement, cela permet une inscription illimitée. |
| `enable_signup` | `true` (définir `false` en production après l'intégration) | Élevé | Combiné avec `default_user_role = "user"`, tout visiteur peut s'auto-enregistrer et accéder à tous les modèles. |
| `memory_limit` | `4Gi` | Élevé | Les pipelines RAG peuvent consommer 3 à 6 Gio sous charge ; une mémoire insuffisante provoque des arrêts OOM en cours d'ingestion. |
| `backup_schedule` | `0 2 * * *` | Élevé | Sans sauvegardes automatisées, la base de données PostgreSQL (utilisateurs, conversations, données RAG) n'est pas protégée. |
| `application_version` | version épinglée en production | Moyen | `latest` risque une mise à niveau involontaire avec un changement de schéma qui fait planter le démarrage. |
| `min_instance_count` | `1` pour une utilisation interactive | Moyen | `0` ajoute une latence de démarrage à froid de 30 à 60 s lorsque la première requête arrive (démarrage du pod + proxy Cloud SQL). |
| `enable_nfs` | `true` lorsque `max_instance_count > 1` | Moyen | Sans stockage partagé, les fichiers téléchargés sont locaux au pod et invisibles pour les autres réplicas. |
| `timeout_seconds` | `300` (augmenter pour RAG/LLM) | Moyen | L'ingestion de documents et les réponses de grands modèles sont coupées au délai d'expiration de l'équilibreur de charge. |
| `stateful_pvc_enabled` | `null`/`false` (utiliser GCS à la place) | Moyen | Les StatefulSets adossés à des PVC empêchent la migration des pods ; utiliser GCS Fuse sauf si les IOPS locales sont critiques. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans eux, l'interface utilisateur est accessible publiquement avec seulement l'authentification intégrée d'Open WebUI comme porte d'accès. |

---

Pour le comportement de la fondation référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Open WebUI partagée avec la
variante Cloud Run est décrite dans **[OpenWebUI_Common](OpenWebUI_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : OpenWebUI sur GKE Autopilot](../labs/OpenWebUI_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Open WebUI Common — Configuration d'application partagée](OpenWebUI_Common.md) — la configuration partagée par les deux cibles de déploiement.
