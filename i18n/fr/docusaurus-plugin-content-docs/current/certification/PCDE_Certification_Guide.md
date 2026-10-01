---
title: "Carte des labs de la certification Professional Cloud Database Engineer (PCDE)"
description: "Associez chaque domaine de l'examen Professional Cloud Database Engineer (PCDE) à des labs pratiques de déploiement RAD sur Google Cloud : un parcours de révision concret, aligné sur l'examen."
---
<!-- translated-from: docs/certification/PCDE_Certification_Guide.md @ cb682e8 -->

# Carte des labs de la certification Professional Cloud Database Engineer (PCDE) {#professional-cloud-database-engineer-pcde-certification-lab-map}

> 📚 **Guide officiel de l'examen :** [Certification Professional Cloud Database Engineer](https://cloud.google.com/learn/certification/cloud-database-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

La certification Professional Cloud Database Engineer valide votre capacité à concevoir, gérer, migrer et déployer des solutions de bases de données évolutives et hautement disponibles sur Google Cloud. Les modules de base de RAD — `Services_GCP`, `App_CloudRun`, `App_GKE` et `App_Common` — servent de lab réel pour l'essentiel de cet examen : `Services_GCP` provisionne Cloud SQL (PostgreSQL et MySQL), Firestore Enterprise et Memorystore Redis derrière un VPC privé (AlloyDB uniquement dans un projet Google Cloud que vous apportez — il n'est pas disponible dans les projets gérés par RAD), tandis que `App_CloudRun` et `App_GKE` montrent comment de vraies applications se connectent à ces bases de données, s'y authentifient, les sauvegardent, les surveillent et font tourner leurs identifiants — le tout piloté par l'infrastructure as code, qui est en soi la concrétisation de l'objectif de l'examen « automatiser le provisionnement des instances de base de données ».

> **Note sur les abréviations :** dans ce dépôt, **PDE** désigne les guides Professional Cloud **DevOps** Engineer. Cette certification — Professional Cloud **Database** Engineer — utilise l'abréviation **PCDE** partout.

## Comment utiliser ce guide {#how-to-use-this-guide}

- Déployez l'un des profils ci-dessous depuis votre portail de déploiement, puis parcourez le guide de section correspondant pendant que l'infrastructure est en service.
- **Les paramètres d'un profil s'appliquent par une mise à jour (Update).** À la création, le formulaire de déploiement ne demande que la première page des entrées d'un module (dans un projet que RAD crée pour vous, guère plus que le nom du locataire et la région). Déployez d'abord le module, puis définissez les variables du profil avec **Update** (mettre à jour) sur la page du déploiement après avoir coché **Enable advanced mode** (activer le mode avancé), ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour.
- **Certains paramètres nécessitent un projet que vous apportez.** Lorsqu'un déploiement est effectué dans un projet géré par RAD (un projet que RAD crée pour vous), le formulaire de déploiement omet tout paramètre qu'un module signale comme indisponible dans ce cas — les paramètres qui dépassent le cadre du projet pour atteindre l'organisation de RAD, ou qui nécessitent une API que les paliers gérés par RAD n'autorisent pas. Dans ce guide, cela concerne `enable_alloydb` (l'API AlloyDB n'est autorisée sur aucun palier géré par RAD, donc RAD n'y déploie pas AlloyDB) et `enable_vpc_sc` ; déployez les profils qui les définissent dans votre propre projet Google Cloud.
- Chaque guide de section associe une modification dans le portail à ce qu'il faut observer dans la console GCP et à une vraie commande `gcloud`/`psql`/`kubectl`.
- Servez-vous de la légende de couverture pour savoir quels sujets de l'examen doivent être étudiés en dehors de la plateforme — Spanner, Bigtable, BigQuery et Database Migration Service ne sont *pas* mis en œuvre par ces modules, et les guides de section le disent clairement.
- Détruisez ou réduisez les profils coûteux (Cloud SQL REGIONAL, et AlloyDB dans un projet que vous apportez) à la fin de chaque session de révision.

**Légende de couverture**

| Symbole | Signification |
|---|---|
| ✅ | Entièrement démontré — déployez-le, observez-le, modifiez-le sur la plateforme RAD |
| 🟡 | Partiellement démontré — les modules abordent le concept ; complétez avec la documentation |
| 📘 | Concept uniquement — non mis en œuvre par les modules ; pistes d'étude fournies |

## Profils de déploiement {#deployment-profiles}

### Profil : relational-baseline {#profile-relational-baseline}
*Objectif :* le lab au coût minimal — une instance PostgreSQL zonale à IP privée, plus une application Cloud Run qui s'y connecte via le volume du connecteur Cloud SQL.
*Modules :* `Services_GCP` + `App_CloudRun`.

| Variable | Valeur |
|---|---|
| `create_postgres` | `true` (par défaut) |
| `postgres_database_availability_type` | `ZONAL` (par défaut) |
| `postgres_tier` | `db-custom-1-3840` (par défaut) |
| `database_type` (App_CloudRun) | `POSTGRES` (par défaut) |
| `enable_cloudsql_volume` (App_CloudRun) | `true` (par défaut) |

*Coût supplémentaire estimé :* faible — une instance Cloud SQL Enterprise à 1 vCPU avec un disque PD_SSD de 10 Go représente l'essentiel du coût.

### Profil : ha-production {#profile-ha-production}
*Objectif :* section 1.2 et section 4 — haute disponibilité REGIONAL, réplique en lecture interrégionale, CMEK, authentification IAM à la base de données et alertes sur la base de données.
*Modules :* `Services_GCP` (redéployez/mettez à jour la base relational-baseline).

| Variable | Valeur |
|---|---|
| `availability_regions` | `["us-central1", "us-east1"]` |
| `subnet_cidr_range` | un CIDR par région, par ex. `["10.0.0.0/24", "10.0.1.0/24"]` |
| `postgres_database_availability_type` | `REGIONAL` |
| `create_postgres_read_replica` | `true` |
| `postgres_read_replica_count` | `1` |
| `enable_cloudsql_iam_auth` | `true` |
| `enable_cmek` | `true` |
| `configure_email_notification` | `true` |
| `notification_alert_emails` | `["you@example.com"]` |

*Coût supplémentaire estimé :* modéré à élevé — REGIONAL double à peu près le coût de l'instance principale, et chaque réplique en lecture est facturée comme une autre instance de la taille de l'instance principale.

### Profil : multi-engine {#profile-multi-engine}
*Objectif :* section 1.4 et section 2 — exécuter côte à côte PostgreSQL, MySQL, Memorystore Redis et Firestore Enterprise (compatible MongoDB) pour comparer les moteurs.
*Modules :* `Services_GCP`.

| Variable | Valeur |
|---|---|
| `create_postgres` | `true` (par défaut) |
| `create_mysql` | `true` |
| `create_redis` | `true` |
| `redis_tier` | `STANDARD_HA` |
| `redis_persistence_mode` | `RDB` |
| `create_firestore` | `true` |

*Coût supplémentaire estimé :* modéré — une deuxième instance Cloud SQL plus une instance Redis STANDARD_HA (~2× BASIC) ; Firestore Enterprise est facturé à l'opération et reste négligeable à l'échelle d'un lab.

### Profil : alloydb-ai {#profile-alloydb-ai}
*Objectif :* sections 1.1, 1.4 et 2.4 — un cluster AlloyDB avec une instance principale et un pool de lecture évolutif horizontalement, pour étudier les charges de travail analytiques/vectorielles.
*Modules :* `Services_GCP`, **uniquement dans un projet Google Cloud que vous apportez**. AlloyDB n'est pas disponible dans les projets gérés par RAD — le formulaire de déploiement y omet `enable_alloydb` et la liste d'API autorisées des dossiers de palier le refuse lors de l'apply. Sans projet personnel, considérez AlloyDB comme 📘 et étudiez-le dans la documentation.

| Variable | Valeur |
|---|---|
| `enable_alloydb` | `true` |
| `alloydb_cpu_count` | `2` (par défaut ; valeurs autorisées : 2, 4, 8, 16, 32, 64) |
| `enable_alloydb_read_pool` | `true` |
| `alloydb_read_pool_node_count` | `1` (par défaut ; 1–20) |

*Coût supplémentaire estimé :* élevé — AlloyDB n'a pas de niveau à cœur partagé ; l'instance principale à 2 vCPU plus chaque nœud du pool de lecture représentent l'essentiel du coût. Détruisez l'ensemble après chaque session.

### Profil : app-dataops {#profile-app-dataops}
*Objectif :* sections 2.3, 2.5 et 3.1 — exports planifiés de la base de données, imports ponctuels de sauvegardes, rotation automatisée des mots de passe et utilisateurs de base de données gérés par des jobs d'initialisation.
*Modules :* `App_CloudRun` (ou `App_GKE`) par-dessus relational-baseline.

| Variable | Valeur |
|---|---|
| `database_type` | `POSTGRES` (par défaut) |
| `backup_schedule` | `"0 2 * * *"` (par défaut) |
| `backup_retention_days` | `7` (par défaut) |
| `enable_backup_import` | `true` (après avoir déposé un fichier ; voir le guide de la section 3) |
| `backup_source` / `backup_file` / `backup_format` | `gcs` / `backup.sql` / `sql` |
| `enable_auto_password_rotation` | `true` |
| `secret_rotation_period` | `"2592000s"` (par défaut, 30 jours) |

*Coût supplémentaire estimé :* faible — les jobs Cloud Run, Cloud Scheduler et les versions Secret Manager coûtent quelques centimes ; le bucket GCS des sauvegardes est élagué par des règles de cycle de vie.

## Section 1 : Concevoir des solutions de bases de données cloud innovantes, évolutives et hautement disponibles (Design innovative, scalable, and highly available cloud database solutions) (~32 % de l'examen) {#section-1-design-innovative-scalable-and-highly-available-cloud-database-solutions-32-of-the-exam}

La section la plus lourde. `Services_GCP` en est la vedette : chaque décision de conception évaluée par l'examen — type de machine, disponibilité zonale ou régionale, connectivité privée, chiffrement, choix du moteur — est une variable que vous pouvez basculer et observer.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 1.1 Planification de la capacité et de l'utilisation de la base de données | ✅ | `postgres_tier`, `redis_memory_size_gb`, redimensionnement automatique du disque (`alloydb_cpu_count` dans un projet que vous apportez) | [Guide de la section 1](PCDE_Section_1_Exploration_Guide.md#11-analyze-relevant-variables-to-perform-database-capacity-and-usage-planning) |
| 1.2 Options de HA et de reprise après sinistre | ✅ | `postgres_database_availability_type`, `create_postgres_read_replica`, paramètres de PITR/sauvegarde, `sql_maintenance_window_day`/`_hour` + `sql_maintenance_update_track` | [Guide de la section 1](PCDE_Section_1_Exploration_Guide.md#12-evaluate-database-high-availability-and-disaster-recovery-options-given-the-requirements) |
| 1.3 Connectivité des applications, chiffrement, audit | ✅ | IP privée via PSA, `ssl_mode`, `enable_cmek`, `enable_cloudsql_volume`, sidecar Auth Proxy (App_GKE), `enable_audit_logging` (poolers de sessions 📘) | [Guide de la section 1](PCDE_Section_1_Exploration_Guide.md#13-determine-how-applications-will-connect-to-the-database) |
| 1.4 Évaluation des solutions de bases de données (SQL/NoSQL/vectorielle, gérée ou non gérée, IA générative) | 🟡 | Cloud SQL vs Firestore Enterprise (compatibilité MongoDB) vs Redis vs VM Redis autogérée (AlloyDB uniquement dans un projet que vous apportez) ; Spanner/Bigtable/BigQuery, Bare Metal Solution, offres partenaires, contraintes de règles d'administration 📘 | [Guide de la section 1](PCDE_Section_1_Exploration_Guide.md#14-evaluate-appropriate-database-solutions-on-google-cloud) |

## Section 2 : Gérer une solution pouvant couvrir plusieurs technologies de bases de données (Manage a solution that can span multiple database technologies) (~25 % de l'examen) {#section-2-manage-a-solution-that-can-span-multiple-database-technologies-25-of-the-exam}

Les opérations du « jour 2 » : utilisateurs et IAM, surveillance, sauvegarde/restauration, mise à l'échelle et automatisation. Les modules applicatifs (`App_CloudRun`/`App_GKE`) portent l'essentiel de cette section — jobs db-init, planificateurs d'export, pipelines de rotation et règles d'alerte.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 2.1 Connectivité et gestion des accès (IAM, utilisateurs de base de données) | ✅ | `enable_cloudsql_iam_auth`, attributions `roles/cloudsql.instanceUser`, le script de création d'utilisateurs db-init, IAM par secret | [Guide de la section 2](PCDE_Section_2_Exploration_Guide.md#21-determine-database-connectivity-and-access-management-considerations) |
| 2.2 Surveillance et dépannage | ✅ | Règles d'alerte Cloud SQL sur le CPU, la mémoire et le disque (Services_GCP), `alert_policies` + `uptime_check_config` dans les modules App, `enable_query_insights` (Services_GCP) ; analyse des requêtes lentes 📘 | [Guide de la section 2](PCDE_Section_2_Exploration_Guide.md#22-configure-database-monitoring-and-troubleshooting-options) |
| 2.3 Sauvegarde et restauration (RTO/RPO/PITR, conservation) | ✅ | configuration des sauvegardes gérées, PITR + conservation des journaux sur 7 jours, jobs d'export/import, `backup_retention_days` | [Guide de la section 2](PCDE_Section_2_Exploration_Guide.md#23-design-database-backup-and-recovery-solutions) |
| 2.4 Optimiser le coût et les performances des bases de données dans Google Cloud | ✅ | mise à l'échelle verticale (`postgres_tier`) ou horizontale (`postgres_read_replica_count`), `postgres_database_flags` (équivalents AlloyDB dans un projet que vous apportez) ; optimisation des requêtes 📘 | [Guide de la section 2](PCDE_Section_2_Exploration_Guide.md#24-optimize-database-cost-and-performance-in-google-cloud) |
| 2.5 Automatiser les tâches courantes sur les bases de données | ✅ | job d'export Cloud Scheduler, CronJob `db-export` (GKE), le pipeline de rotation des mots de passe, maintenance planifiée via `sql_maintenance_window_*` ; mises à niveau gérées 📘 | [Guide de la section 2](PCDE_Section_2_Exploration_Guide.md#25-automate-common-database-tasks) |

## Section 3 : Migrer des solutions de données (Migrate data solutions) (~23 % de l'examen) {#section-3-migrate-data-solutions-23-of-the-exam}

Les modules mettent en œuvre de bout en bout le chemin de migration par export/import (avec interruption prolongée), mais Database Migration Service, Datastream et la réplication continue depuis des sources externes relèvent du concept uniquement — prévoyez ici un vrai temps d'étude.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 3.1 Concevoir et mettre en œuvre la migration et la réplication de données | 🟡 | jobs d'import `enable_backup_import` + `backup_source` (gcs/gdrive), jobs d'export logique planifiés, `enable_custom_sql_scripts` ; DMS / Datastream / migration sans interruption / réplication inverse 📘 | [Guide de la section 3](PCDE_Section_3_Exploration_Guide.md#31-design-and-implement-data-migration-and-replication) |

## Section 4 : Déployer des bases de données évolutives et hautement disponibles dans Google Cloud (Deploy scalable and highly available databases in Google Cloud) (~20 % de l'examen) {#section-4-deploy-scalable-and-highly-available-databases-in-google-cloud-20-of-the-exam}

Cette section est le terrain de prédilection du dépôt : « automatiser le provisionnement des instances de base de données » est littéralement ce que font ces modules d'infrastructure as code. Déployez le profil ha-production et entraînez-vous au basculement, à la mise à l'échelle des répliques et à la surveillance de la HA sur de vraies instances.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 4.1 Mettre en œuvre des bases de données évolutives et hautement disponibles (provisionner la HA, tester la HA/reprise après sinistre, répliques en lecture, provisionnement automatisé, surveillance) | ✅ | `postgres_database_availability_type = REGIONAL`, `postgres_read_replica_count`, `gcloud sql instances failover`, les modules d'infrastructure as code eux-mêmes, les règles d'alerte Cloud SQL (processus de promotion interrégionale 🟡) | [Guide de la section 4](PCDE_Section_4_Exploration_Guide.md#41-apply-concepts-to-implement-scalable-and-highly-available-databases-in-google-cloud) |
