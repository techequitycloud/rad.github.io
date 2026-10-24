---
title: "Windmill sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Windmill sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Windmill_CloudRun.md @ e69407af sha256:39db71949b3e -->

# Windmill sur Google Cloud Run {#windmill-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Windmill_CloudRun.png" alt="Windmill sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Windmill est une plateforme de développement open source pour la création d'outils internes, de scripts, de flux et d'automatisations. Ce module déploie Windmill sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Windmill et sur la manière de les explorer et de les opérer à partir de la console Google Cloud et de la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Coût de Windmill sur RAD et comparaison {#what-windmill-costs-on-rad-and-how-that-compares}

**L'exécution de Windmill sur Cloud Run dans votre propre projet Google Cloud coûte environ 156,93 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 75 crédits facturé une seule fois au moment du déploiement. Windmill a besoin d'une base de données PostgreSQL derrière lui, et parce que ses workers fonctionnent en permanence plutôt que de se mettre à l'échelle à zéro, le service Cloud Run lui-même représente la majeure partie de ces 156,93 $. Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide GKE](Windmill_GKE.md) si vous préférez l'exécuter sur Kubernetes, qui est également l'option la moins chère pour cette application.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 156,93 $/mois, facturé par Google au prix catalogue | ~72 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 2 Gio (alwaysOn) | 99,90 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **156,93 $** |

### Comparaison {#how-it-compares}

- L'équipe de Windmill vend son propre plan Cloud/Enterprise hébergé : [windmill.dev/pricing](https://www.windmill.dev/pricing) (vérifié le 8 octobre 2026) liste un niveau Communauté gratuit et à exécution illimitée à 0 $/mois et un niveau Enterprise à partir de 120 $/mois pour une observabilité avancée, la sécurité et le support SAML — son propre configurateur de coûts évalue un petit espace de travail exemple (1 développeur, 2 workers standard) à environ 170 $/mois, dans la même fourchette que le coût d'exécution de 156,93 $/mois du projet propre de RAD ci-dessus.
- Choisir l'auto-hébergement sur RAD plutôt que le cloud de Windmill échange principalement leur plan de contrôle multi-locataire géré contre un contrôle total de vos données et de votre instance Postgres, à un prix globalement comparable une fois les frais de module et les crédits de build inclus.
- Une alternative VPS nu fonctionne également : un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois, ou des boîtiers Hetzner/DigitalOcean de taille similaire à environ 24 $/mois, peuvent exécuter Windmill et Postgres ensemble — moins cher en termes d'argent, mais sans les sauvegardes gérées, les correctifs et la surveillance de RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer
le projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne détruit **pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble
du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter Update sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser
le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart
des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé Windmill et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime les ressources définitivement, et la remise en service de Windmill signifie un redéploiement à partir de
zéro. Cela coûte environ 78 à 81 crédits (les 75 crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si Windmill devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour Windmill, c'est environ 2 jours ou plus.
La majeure partie de ce coût d'exécution est généralement la base de données — elle ne s'arrête que lorsque rien d'autre dans le projet ne l'utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Priorité aux données : les sauvegardes nocturnes sont stockées dans un bucket au sein du déploiement et sont supprimées avec celui-ci.
Copiez donc la dernière sauvegarde avant de supprimer si vous souhaitez la conserver.

### Sessions de laboratoire et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de laboratoire, pour la formation : un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les revendications de pause/restauration. Prix de Windmill Cloud sur [windmill.dev/pricing](https://www.windmill.dev/pricing), vérifié le 8 octobre 2026.

## 1. Vue d'ensemble {#1-overview}

Windmill s'exécute en tant que conteneur combiné serveur+worker sur Cloud Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service combiné serveur+worker, 2 vCPU / 2 Gio par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 16 | Requis — Windmill nécessite PostgreSQL 16 ou ultérieur |
| Stockage d'objets | Cloud Storage | Un bucket `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties de workflow et les artefacts |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré et secret de remplacement SMTP |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 16 est requis.** Windmill utilise des fonctionnalités spécifiques à PostgreSQL ; le moteur de base de données est fixe. L'utilisation d'une version plus ancienne ou de `NONE` entraînera l'échec du job d'initialisation.
- **Mode combiné serveur+worker.** `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur API et les workers d'exécution de scripts dans la même instance de conteneur. Pour une mise à l'échelle indépendante des workers à haut débit, utilisez `Windmill_GKE`.
- **`DISABLE_NSJAIL=true` est injecté automatiquement.** Cloud Run n'accorde pas `CAP_SYS_ADMIN` ; l'isolation de l'espace de noms Linux de Windmill est désactivée en conséquence.
- **Les sondes de santé utilisent HTTP `GET /api/version`.** Ce point de terminaison léger renvoie la chaîne de version de Windmill lorsque le service est prêt. Cloud Run n'émet pas de redirections HTTP→HTTPS sur ce chemin, donc une sonde HTTP fonctionne correctement.
- **`BASE_URL` et `BASE_INTERNAL_URL` sont construits au démarrage** à partir de variables injectées par la plateforme afin que les rappels OAuth et les URL de webhook se résolvent correctement.
- **Redis est désactivé par défaut.** Windmill fonctionne sans Redis pour les déploiements à instance unique. Activez Redis pour un comportement de file d'attente distribuée avec plusieurs instances.
- **Un secret de remplacement SMTP est provisionné automatiquement.** Remplacez la valeur `{prefix}-smtp-password` dans Secret Manager avant d'activer les notifications par e-mail.
- **`min_instance_count` par défaut à `1`.** Le conteneur exécute le serveur de Windmill et son pool de workers (`MODE=server,worker`), c'est donc ce qui exécute les jobs planifiés ; à `0` Cloud Run le récupère environ 15 minutes après la dernière requête et planifie l'arrêt des déclenchements.
- **`cpu_always_allocated` par défaut à `true`.** Les jobs s'exécutent sur un worker en arrière-plan, et sous la facturation basée sur les requêtes, ce travail est limité à presque zéro entre les requêtes. Conservez les deux valeurs par défaut pour des planifications et des webhooks fiables.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Windmill {#a-cloud-run--the-windmill-service}

Windmill s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 16 {#b-cloud-sql-for-postgresql-16}

Windmill stocke toutes les données d'application — scripts, flux, variables, ressources, planifications et historique des jobs — dans une instance gérée de Cloud SQL pour PostgreSQL 16. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un job d'initialisation crée de manière idempotente la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est provisionné pour les sorties de workflow, les artefacts et les dépendances de scripts. Le compte de service de la charge de travail se voit accorder un accès automatique.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de bucket supplémentaires, les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données et le mot de passe de remplacement SMTP sont stockés dans Secret Manager et injectés dans le service au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et le contrôle de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs de conteneurs sont acheminés vers Cloud Logging au format JSON structuré (`JSON_FMT=true`). Les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives. Un point de terminaison de métriques Prometheus est exposé à `:9001` pour le scraping au sein du VPC.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Windmill {#3-windmill-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) s'exécute au premier déploiement en utilisant `postgres:16-alpine`. Il crée de manière idempotente les rôles `windmill_admin` et `windmill_user`, l'utilisateur de l'application et la base de données de l'application, puis accorde tous les privilèges et l'appartenance aux deux rôles (Windmill a besoin de `SET ROLE windmill_admin`). Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma automatiques.** Windmill exécute ses propres migrations de base de données au démarrage, de sorte que la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Mode combiné serveur+worker.** Chaque instance exécute à la fois l'API/ordonnanceur Windmill et `NUM_WORKERS=3` workers d'exécution de scripts. Les workers exécutent des scripts Python, TypeScript, Bash, Go et SQL dans des sous-processus isolés. L'affectation `WORKER_GROUP=default` signifie que tous les flux et scripts sont acheminés vers ces instances par défaut.
- **Construction de `BASE_URL` et `DATABASE_URL`.** Le shim `entrypoint.sh` construit `DATABASE_URL` à partir des variables `DB_*` injectées par la plateforme au démarrage, gérant à la fois les connexions par socket Unix (Auth Proxy) et TCP. `BASE_URL` et `BASE_INTERNAL_URL` sont définis à partir de l'URL de service prédite afin que les rappels OAuth et les webhooks se résolvent correctement.
- **Métriques Prometheus.** `METRICS_ADDR=:9001` expose les métriques Windmill à `http://<instance-ip>:9001/metrics` pour le scraping depuis le VPC.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent toutes deux `GET /api/version`. Ce point de terminaison renvoie HTTP 200 avec la chaîne de version lorsque Windmill est prêt à servir le trafic.
- **Notifications par e-mail SMTP.** Le secret `WINDMILL_SMTP_PASS` est initialisé avec un placeholder de 16 caractères. Remplacez-le et fournissez `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT` et `WINDMILL_SMTP_FROM` via `environment_variables` pour activer les notifications par e-mail à partir des flux et des scripts.
- **Inspecter les jobs et leurs exécutions :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Windmill sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `application_name` | `windmill` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Windmill` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Windmill ; défini sur une version spécifique (par exemple `1.400.0`) pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit avec le Dockerfile fourni ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `""` | Remplacer l'URI de l'image. Laisser vide pour que Cloud Build gère. |
| `cpu_limit` | `2000m` | CPU par instance. 2 vCPU est le minimum recommandé pour le mode combiné serveur+worker. |
| `memory_limit` | `2Gi` | Mémoire par instance. 4 Gio recommandé pour les charges de travail Python/TypeScript en production. |
| `min_instance_count` | `1` | Instances minimales. Définir ≥ 1 pour que les webhooks et les flux planifiés soient toujours disponibles sans démarrage à froid. |
| `max_instance_count` | `3` | Instances maximales. Utiliser Redis lors de la mise à l'échelle au-delà de 1 pour coordonner les files d'attente de jobs. |
| `container_port` | `8000` | Windmill écoute sur le port 8000. |
| `execution_environment` | `gen2` | Génération 2 requise pour les montages GCS Fuse et la compatibilité Linux complète. |
| `timeout_seconds` | `300` | Durée maximale de la requête. Augmenter (jusqu'à 3600) pour les scripts de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis pour la connexion par socket Unix. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Windmill dans Artifact Registry pour éviter les limites de débit de ghcr.io. |
| `traffic_split` | `[]` | Allocation de trafic Canary/bleu-vert entre les révisions. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés avec les valeurs par défaut de Windmill. Utiliser pour définir `WINDMILL_SMTP_HOST`, les remplacements `NUM_WORKERS`, etc. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. `WINDMILL_SMTP_PASS` est injecté automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé et NFS {#group-9--custom-sql--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB (seuls les actifs statiques en bénéficient). |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket `data` et tout bucket supplémentaire. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `enable_nfs` | `false` | NFS est désactivé par défaut — Windmill ne nécessite pas de stockage de fichiers partagé. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via la fonctionnalité de volume de stockage Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixe — Windmill nécessite PostgreSQL 16. Ne pas modifier. |
| `db_name` | `windmill` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `windmill` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job PostgreSQL `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/version`, délai initial de 60s, 10 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/version`, délai initial de 60s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/version` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour un comportement de file d'attente distribuée (facultatif). |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyé lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critique | Windmill nécessite PostgreSQL 16 ; l'utilisation d'une version plus ancienne entraîne l'échec du job d'initialisation et la non-initialisation de la base de données. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les scripts, flux et l'historique des jobs. |
| `enable_cloudsql_volume` | `true` | Critique | Windmill se connecte via le socket Unix Auth Proxy ; la désactivation de cette option entraîne une défaillance immédiate de la base de données et des plantages de conteneurs au démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `cpu_limit` | `2000m` | Élevé | Le mode combiné exécute 3 workers en cours de processus ; un CPU insuffisant limite toutes les exécutions de scripts. Chaque worker a besoin d'environ 500m. |
| `memory_limit` | `2Gi` | Élevé | Les workers Windmill exécutent des scripts utilisateur arbitraires ; les kills OOM en cours d'exécution produisent des échecs silencieux dans l'interface utilisateur. |
| `min_instance_count` | `1` (par défaut) | Élevé | La réduction à `0` permet à Cloud Run de récupérer l'instance lorsqu'elle est inactive, et avec elle le pool de workers — les flux planifiés cessent de se déclencher jusqu'à ce qu'une requête réveille le service. |
| `cpu_always_allocated` | `true` (par défaut) | Élevé | La définition de `false` limite le worker en arrière-plan entre les requêtes, de sorte que les jobs planifiés et les exécutions en file d'attente s'exécutent plusieurs fois plus lentement ou s'arrêtent. |
| `service_url` / `BASE_URL` | URL Cloud Run ou domaine personnalisé | Élevé | Une valeur vide ou incorrecte interrompt les rappels OAuth, les points de terminaison de webhook et les liens profonds de l'interface utilisateur Windmill. |
| `execution_environment` | `gen2` | Élevé | La Gen1 ne prend pas en charge les montages GCS Fuse ; requis lorsque `gcs_volumes` est utilisé. |
| `enable_vpc_sc` | `false` sauf si nécessaire | Élevé | Nécessite `organization_id` explicite ; sans cela, VPC-SC est silencieusement ignoré, donnant une fausse impression de sécurité périmétrique. |
| `enable_redis` | `false` pour instance unique, `true` pour multi | Moyen | Sans Redis, plusieurs instances traitent chacune leur propre file d'attente, ce qui peut entraîner une duplication ou une famine de jobs. |
| `max_instance_count` | `3` | Moyen | Au-delà d'une instance sans coordination Redis, le même job peut être pris en charge par plusieurs workers simultanément. |
| `timeout_seconds` | `300` (augmenter pour les jobs longs) | Moyen | Les jobs Windmill qui dépassent le délai d'attente de requête Cloud Run sont interrompus en cours d'exécution sans erreur gracieuse. |
| `backup_schedule` | `0 2 * * *` | Moyen | Une chaîne vide désactive les sauvegardes ; Windmill stocke toutes les définitions d'automatisation dans PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans cela, l'interface utilisateur et l'API Windmill sont accessibles publiquement. |
| `WINDMILL_SMTP_*` (via variables d'environnement) | tous les champs définis ensemble | Moyen | Une configuration SMTP partielle entraîne des échecs silencieux de livraison d'e-mails sans erreur d'exécution. |
| `enable_auto_password_rotation` | `false` | Moyen | Lorsqu'elle est activée, la révision Cloud Run doit être redéployée après la rotation ; sinon, elle utilise un mot de passe expiré jusqu'à ce que les connexions échouent. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Windmill partagée avec la variante GKE est décrite dans **[Windmill_Common](Windmill_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Windmill sur Cloud Run](../labs/Windmill_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Windmill sur GKE Autopilot](Windmill_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Windmill Common — Configuration d'application partagée](Windmill_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Kestra sur Google Cloud Run](Kestra_CloudRun.md), [Temporal sur GKE Autopilot](Temporal_GKE.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) dans la solution **Orchestration de données et de workflows**.
