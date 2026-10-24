---
title: "Windmill sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Windmill sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Windmill_GKE.md @ 1665a43e sha256:40817c6c8aba -->

# Windmill sur GKE Autopilot {#windmill-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Windmill_GKE.png" alt="Windmill sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Windmill est une plateforme de développement open source pour la création d'outils internes, de scripts, de flux et d'automatisations. Ce module déploie Windmill sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Windmill et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Windmill sur RAD, et comment cela se compare {#what-windmill-costs-on-rad-and-how-that-compares}

**L'exécution de Windmill sur des pods GKE Autopilot dans votre propre projet Google Cloud coûte environ 129,18 $/mois en frais Google Cloud**, en plus d'un coût de module RAD unique de 110 crédits facturé une seule fois au moment du déploiement. Windmill a besoin d'une base de données PostgreSQL derrière lui, ce qui, avec le pod toujours actif, représente la majeure partie de ces 129,18 $. Dans un projet géré par RAD, le coût du module tombe à 99 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](Windmill_CloudRun.md) pour l'option moins coûteuse.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Coût du module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 129,18 $/mois, facturé par Google au prix catalogue | ~107 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **129,18 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- L'équipe de Windmill vend son propre plan Cloud/Enterprise hébergé : [windmill.dev/pricing](https://www.windmill.dev/pricing) (vérifié le 8 octobre 2026) liste un niveau Communauté gratuit et à exécution illimitée à 0 $/mois et un niveau Entreprise à partir de 120 $/mois pour une observabilité avancée, la sécurité et le support SAML — son propre configurateur de coûts évalue un petit espace de travail exemple (1 développeur, 2 workers standard) à environ 170 $/mois, dans la même fourchette que le coût d'exécution de 129,18 $/mois du projet propre de RAD ci-dessus.
- Choisir l'auto-hébergement sur RAD plutôt que le cloud de Windmill échange principalement leur plan de contrôle multi-locataire géré contre un contrôle total de vos données et de votre instance Postgres, à un prix globalement comparable une fois les frais de module et les crédits de build inclus.
- Une alternative bare-VPS fonctionne également : un e2-standard-2 (2 vCPU/8 Go) de GCP Compute Engine à environ 49 $/mois, ou des boîtiers Hetzner/DigitalOcean de taille similaire à environ 24 $/mois, peuvent exécuter Windmill et Postgres ensemble — moins cher en termes d'argent, mais sans les sauvegardes, les correctifs et la surveillance gérés par RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne supprime **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne
typique de 2-3 déploiements.

Ce qu'il faut : vous devez posséder le projet (pas un projet que RAD gère uniquement pour la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Windmill et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et le retour de Windmill signifie un redéploiement à partir de
zéro. Cela coûte environ 113-116 crédits (les frais de module de 110 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Windmill devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Windmill, c'est environ 3 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données — elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de labo, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de
l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [Documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration. Prix de Windmill Cloud sur [windmill.dev/pricing](https://www.windmill.dev/pricing), vérifié le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Windmill fonctionne comme une charge de travail combinée serveur+worker. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods serveur+worker combinés, 2 vCPU / 2 GiB par défaut, auto-scalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 16 | Requis — Windmill nécessite PostgreSQL 16 ou ultérieur |
| Stockage d'objets | Cloud Storage | Un bucket `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties et artefacts de workflow |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré et secret de remplacement SMTP |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 16 est requis.** Windmill utilise des fonctionnalités spécifiques à PostgreSQL ; le moteur de base de données est fixe. La sélection d'une version plus ancienne ou `NONE` entraînera l'échec du job d'initialisation.
- **Mode serveur+worker combiné.** `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur API et les workers d'exécution de scripts dans le même pod. Pour une mise à l'échelle indépendante des workers, définissez des déploiements Kubernetes supplémentaires via `additional_services`.
- **`DISABLE_NSJAIL=true` est injecté automatiquement.** GKE Autopilot n'accorde pas `CAP_SYS_ADMIN` ou les espaces de noms utilisateur ; l'isolation de l'espace de noms Linux de Windmill est désactivée en conséquence.
- **Redis est désactivé par défaut.** Windmill fonctionne sans Redis pour les déploiements à réplique unique. Activez Redis pour un comportement de file d'attente distribuée avec plusieurs répliques.
- **`session_affinity` est `None`.** L'API de Windmill est sans état et utilise une authentification basée sur les cookies, de sorte que le routage persistant n'est pas requis.
- **Les sondes de santé ciblent `/api/version`.** Ce point de terminaison léger renvoie la chaîne de version de Windmill lorsque le service est prêt — aucun délai de migration au démarrage n'est requis.
- **Un secret de remplacement SMTP est provisionné automatiquement.** Remplacez la valeur `{prefix}-smtp-password` dans Secret Manager avant d'activer les notifications par e-mail.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Windmill {#a-gke-autopilot--the-windmill-workload}

Les pods Windmill sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et maximal de répliques. Le type de charge de travail par défaut est `Deployment` ; définissez `stateful_pvc_enabled = true` pour sélectionner automatiquement `StatefulSet` avec des volumes persistants par pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Windmill pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 16 {#b-cloud-sql-for-postgresql-16}

Windmill stocke toutes les données d'application — scripts, flux, variables, ressources, planifications et historique des jobs — dans une instance Cloud SQL pour PostgreSQL 16 gérée. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée de manière idempotente la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est provisionné pour les sorties de workflow, les artefacts et les dépendances de script. Le compte de service de la charge de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options de bucket supplémentaires, les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données et le mot de passe de remplacement SMTP sont stockés en tant que secrets Secret Manager et injectés dans les pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et Ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging au format JSON structuré (`JSON_FMT=true`). Les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Un point de terminaison de métriques Prometheus est exposé à `:9001` pour le scraping au sein du VPC.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Windmill {#3-windmill-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) s'exécute au premier déploiement en utilisant `postgres:16-alpine`. Il crée de manière idempotente les rôles `windmill_admin` et `windmill_user`, l'utilisateur de l'application et la base de données de l'application, puis accorde tous les privilèges et l'appartenance aux deux rôles (Windmill doit `SET ROLE windmill_admin`). Le job peut être réexécuté en toute sécurité.
- **Migrations automatiques de schéma.** Windmill exécute ses propres migrations de base de données au démarrage, de sorte que la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Mode serveur+worker combiné.** Chaque pod exécute à la fois l'API/ordonnanceur Windmill et `NUM_WORKERS=3` workers d'exécution de scripts. Les workers exécutent des scripts Python, TypeScript, Bash, Go et SQL dans des sous-processus isolés. L'affectation `WORKER_GROUP=default` signifie que tous les flux et scripts sont acheminés vers ces pods par défaut.
- **`BASE_URL` et `BASE_INTERNAL_URL`.** Le shim `entrypoint.sh` construit `DATABASE_URL` à partir des variables `DB_*` injectées par la plateforme au démarrage. Lorsque `GKE_SERVICE_URL` est défini (injecté par App_GKE une fois l'IP de l'équilibreur de charge allouée), `BASE_URL` est mis à jour automatiquement afin que les rappels OAuth et les URL de webhook soient résolus correctement.
- **Métriques Prometheus.** `METRICS_ADDR=:9001` expose les métriques Windmill à `http://<pod-ip>:9001/metrics` pour le scraping depuis le cluster.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent `GET /api/version`. Ce point de terminaison renvoie HTTP 200 avec la chaîne de version lorsque Windmill est prêt à servir le trafic.
- **Notifications par e-mail SMTP.** Le secret `WINDMILL_SMTP_PASS` est initialisé avec un espace réservé de 16 caractères. Remplacez-le et fournissez `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT` et `WINDMILL_SMTP_FROM` via `environment_variables` pour activer les notifications par e-mail à partir des flux et des scripts.
- **Inspecter les flux et les jobs planifiés :**
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Windmill sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `windmill` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Windmill` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Balise de version de l'image Windmill ; définie sur une version spécifique (par exemple `1.400.0`) pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit avec le Dockerfile fourni ; `prebuilt` déploie une image existante. |
| `container_image` | `""` | Remplace l'URI de l'image. Laissez vide pour que Cloud Build le gère. |
| `cpu_limit` | `2000m` | CPU par pod. 2 vCPU est le minimum recommandé pour le mode serveur+worker combiné. |
| `memory_limit` | `2Gi` | Mémoire par pod. 4 GiB recommandé pour les charges de travail Python/TypeScript en production. |
| `min_instance_count` | `1` | Répliques minimales. Gardez ≥ 1 pour que les webhooks et les flux planifiés aient un pod sur lequel s'exécuter. |
| `max_instance_count` | `3` | Répliques maximales (plafond de l'autoscaler). |
| `container_port` | `8000` | Windmill écoute sur le port 8000. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis pour la connexion par socket Unix. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Windmill dans Artifact Registry pour éviter les limites de débit de ghcr.io. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les demandes de ressources. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM ; augmentez pour permettre aux jobs en cours de se terminer gracieusement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés avec les valeurs par défaut de Windmill. Utilisez pour définir `WINDMILL_SMTP_HOST`, les remplacements `NUM_WORKERS`, etc. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `WINDMILL_SMTP_PASS` est injecté automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `None` | L'API de Windmill est sans état ; le routage persistant n'est pas requis. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Balises de nœud/pod pour les règles de pare-feu. |
| `gke_cluster_name` | `""` | Cluster GKE à utiliser. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour générer automatiquement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC dans un StatefulSet. La définition de `true` sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `/api/version`, période de 10s, 10 échecs | Sonde HTTP contre le point de terminaison de version de Windmill. |
| `health_check_config` | `/api/version`, période de 30s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job PostgreSQL `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents pour les tâches de maintenance ou d'intégration. |
| `additional_services` | `[]` | Déploiements sidecar ou auxiliaires aux côtés de Windmill (par exemple, pools de workers dédiés). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut — Windmill ne nécessite pas de stockage de fichiers partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur lorsque NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `data` et tout bucket supplémentaire. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixe — Windmill nécessite PostgreSQL 16. Ne pas modifier. |
| `db_name` | `windmill` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `windmill` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `['nfsserver']` | Balises de nœud/pod GKE pour les règles de pare-feu. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige la connexion Google devant Windmill. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et Redis {#group-21--cloud-armor--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_redis` | `false` | Active Redis pour un comportement de file d'attente distribuée (facultatif). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide et activez NFS pour la découverte automatique. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Windmill. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors de la première application d'un nouveau cluster inline ; réexécutez l'application pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critique | Windmill nécessite PostgreSQL 16 ; l'utilisation d'une version plus ancienne entraîne l'échec du job d'initialisation et la non-initialisation de la base de données. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les scripts, flux et l'historique des jobs. |
| `enable_cloudsql_volume` | `true` | Critique | Windmill se connecte via le socket Unix du proxy d'authentification ; la désactivation de cela entraîne une défaillance immédiate de la base de données et un CrashLoopBackOff. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `cpu_limit` | `2000m` | Élevé | Le mode combiné exécute 3 workers en cours de processus ; un CPU insuffisant étrangle toute exécution de script. Chaque worker a besoin d'environ 500m. |
| `memory_limit` | `2Gi` | Élevé | Les workers Windmill exécutent des scripts utilisateur arbitraires ; les OOM kills en cours d'exécution produisent des échecs silencieux dans l'interface utilisateur. |
| `min_instance_count` | `1` | Élevé | `0` permet la mise à l'échelle à zéro ; les flux planifiés seront manqués et les webhooks renverront 503 jusqu'à ce qu'un pod soit prêt. |
| `service_url` / `BASE_URL` | IP de l'équilibreur de charge ou domaine personnalisé | Élevé | Une valeur vide ou incorrecte interrompt les rappels OAuth, les points de terminaison de webhook et les liens profonds de l'interface utilisateur Windmill. |
| `enable_redis` | `false` pour une seule réplique, `true` pour plusieurs | Moyen | Sans Redis, chaque pod ne traite que sa propre file d'attente locale ; avec plusieurs répliques, cela entraîne un routage de job imprévisible. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |
| `backup_schedule` | `0 2 * * *` | Moyen | Une chaîne vide désactive les sauvegardes ; Windmill stocke toutes les définitions d'automatisation dans PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans cela, l'interface utilisateur et l'API Windmill sont accessibles publiquement. |
| `WINDMILL_SMTP_*` (via variables d'environnement) | tous les champs définis ensemble | Moyen | Une configuration SMTP partielle entraîne des échecs silencieux de livraison d'e-mails sans erreur d'exécution. |
| `enable_auto_password_rotation` | `false` | Moyen | Lorsqu'il est activé, les pods doivent être redémarrés après la rotation ; sinon, ils utilisent un mot de passe expiré jusqu'à ce que les connexions échouent. |
| `enable_vpc_sc` | `false` sauf si nécessaire | Élevé | Nécessite `organization_id` explicite ; sans cela, VPC-SC est ignoré silencieusement, donnant un faux sentiment de sécurité périmétrique. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Windmill partagée avec la variante Cloud Run est décrite dans **[Windmill_Common](Windmill_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Windmill sur GKE Autopilot](../labs/Windmill_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Windmill sur Google Cloud Run](Windmill_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Windmill Common — Configuration d'application partagée](Windmill_Common.md) — la configuration partagée par les deux cibles de déploiement.
