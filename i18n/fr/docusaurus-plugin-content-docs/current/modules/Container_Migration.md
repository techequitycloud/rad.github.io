---
title: "Migrate to Containers sur GKE"
description: "Référence de configuration du module RAD Migrate to Containers sur Google Cloud — variables, architecture, réseau et exploitation au quotidien."
---

<!-- translated-from: docs/modules/Container_Migration.md @ 3055034 sha256:fc034fd903cc -->

# Migrate to Containers sur GKE {#migrate-to-containers-on-gke}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Container_Migration.png" alt="Migrate to Containers sur GKE" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module provisionne un environnement pratique complet pour s'exercer à **Google Cloud Migrate to Containers (M2C)** — la voie automatisée pour transférer des charges de travail Linux basées sur des VM vers des conteneurs sur Google Kubernetes Engine (GKE) sans modifier le code source des applications. Il s'agit d'un **module autonome** : il construit son propre VPC, ses VM sources, un poste de travail de migration et un cluster GKE cible, et ne dépend d'aucune infrastructure de socle partagée.

Lors de l'apply, le module déploie deux VM sources Ubuntu exécutant de véritables applications (PostgreSQL 14 et Apache Tomcat 10 servant l'application Spring PetClinic), un poste de travail CLI Migrate to Containers préchargé avec la chaîne d'outils de migration, et un cluster GKE multi-nœuds prêt à recevoir les charges de travail migrées. À partir de là, un opérateur parcourt manuellement le cycle de vie M2C : évaluer chaque VM avec la CLI `mcdc`, copier et analyser les systèmes de fichiers avec la CLI `m2c`, générer des Dockerfiles et des manifestes Kubernetes, migrer les données persistantes vers des PersistentVolumes GKE et déployer les conteneurs obtenus avec Skaffold.

Ce guide se concentre sur les services cloud provisionnés par le module et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. La procédure complète destinée à l'opérateur figure dans le [guide du lab](https://docs.radmodules.dev/docs/labs/Container_Migration).

Toutes les ressources partagent le préfixe `mig-<id>-`, où `<id>` est le suffixe du déploiement (par ex. `mig-8b56-postgres`, `mig-8b56-tomcat`, `mig-8b56-m2c`, `mig-8b56-gke-cluster`, `mig-8b56-vpc`).

---

## 1. Vue d'ensemble {#1-overview}

Le module assemble un ensemble ciblé de services Google Cloud pour créer un bac à sable de migration autonome :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Outils de migration | Migrate to Containers (CLI `mcdc` + `m2c`) | Préinstallés sur une VM de poste de travail dédiée ; pilotés par l'opérateur, non provisionnés comme service géré |
| Charges de travail sources | VM Compute Engine | Une VM PostgreSQL 14 et une VM Tomcat 10 / Spring PetClinic, toutes deux sous Ubuntu 22.04 |
| Poste de travail de migration | VM Compute Engine | VM à grand disque avec `m2c`, Docker, `kubectl`, Skaffold et le plug-in d'authentification GKE |
| Plateforme cible | GKE (zonal, standard) | Cluster multi-nœuds (3 nœuds par défaut) qui reçoit les conteneurs migrés |
| Réseau | VPC + règles de pare-feu | VPC en mode automatique avec règles interne/SSH/ICMP plus une règle Tomcat (port 8080) |

**À savoir d'emblée :**

- **Il s'agit d'un environnement d'apprentissage/de démonstration, et non d'un pipeline de migration de production.** La migration elle-même est effectuée manuellement par l'opérateur sur la VM de poste de travail une fois l'infrastructure provisionnée — le module n'exécute pas la migration à votre place.
- **Les VM sources exécutent de véritables applications fonctionnelles.** La VM PostgreSQL héberge une base de données `petclinic` ; la VM Tomcat construit et sert le WAR Spring PetClinic qui s'y connecte. Vous pouvez parcourir PetClinic sur la VM Tomcat avant de migrer quoi que ce soit (sortie `petclinic_url`).
- **Les scripts de démarrage des VM prennent plusieurs minutes.** Chaque VM installe et configure ses logiciels au premier démarrage (configuration de PostgreSQL, build Maven de PetClinic, téléchargement de la chaîne d'outils de migration). Prévoyez environ 5–10 minutes après le déploiement avant que les outils soient prêts ; consultez `/var/log/startup-script.log` sur chaque VM.
- **La chaîne d'outils de migration est téléchargée au démarrage.** `mcdc`, `m2c`, `kubectl` et Skaffold sont récupérés depuis des points de terminaison de publication publics au démarrage des VM. Des scripts pratiques (`/assess_mcdc.sh`, `/install_container_tools.sh` et d'autres) sont écrits sur chaque VM pour piloter les étapes du lab.
- **Le cluster GKE est zonal.** Il est créé dans la `zone` configurée, avec un plan de contrôle et un pool de nœuds unique. Ce module ne propose pas d'option de cluster régional.
- **Les images de conteneur que vous construisez pendant le lab ne sont pas gérées par le module.** Les images poussées vers Artifact Registry / Container Registry et les PersistentVolumeClaims que vous créez subsistent jusqu'à ce que vous les supprimiez manuellement (les PVC sont supprimés lors de la destruction du cluster).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `ZONE` sont définis conformément à votre déploiement. Les noms des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Migrate to Containers (les outils de migration) {#a-migrate-to-containers-the-migration-tooling}

Migrate to Containers est fourni sous forme de deux outils en ligne de commande plutôt que d'un service cloud géré. La CLI **`mcdc`** s'exécute sur chaque VM source pour collecter des données système et produire un rapport d'aptitude à la conteneurisation (en évaluant la charge de travail selon les parcours GKE, GKE Autopilot, Cloud Run et Compute Engine). La CLI **`m2c`** s'exécute sur la VM de poste de travail pour copier le système de fichiers d'une VM source, l'analyser afin d'en tirer un plan de migration, migrer les données persistantes vers GKE et générer des Dockerfiles et des manifestes Kubernetes. Les deux sont préinstallées par les scripts de démarrage du module.

- **Console :** il n'existe pas d'interface de console dédiée pour ce workflow basé sur la CLI. Suivez la progression via les VM sources (Compute Engine) et les charges de travail obtenues (Kubernetes Engine → Charges de travail).
- **CLI (à exécuter sur la VM de poste de travail via SSH) :**
  ```bash
  # Connect to the workstation, then verify the toolchain:
  gcloud compute ssh <m2c-cli-vm> --project "$PROJECT" --zone "$ZONE"
  sudo /install_container_tools.sh        # checks m2c, kubectl, skaffold, docker, auth plugin
  m2c version
  # Core migration commands (see the Lab Guide for the full sequence):
  m2c copy gcloud -p "$PROJECT" -z "$ZONE" -n <source-vm> -o <out-dir> --filters /root/filters.txt
  m2c analyze -s <copied-fs> -p linux-vm-container -o ./migration
  m2c migrate-data -i migration -n default
  m2c generate -i ./migration -o ./artifacts
  ```

### B. Compute Engine — VM sources et poste de travail {#b-compute-engine--source-vms-and-workstation}

Trois VM Compute Engine sont provisionnées, toutes sous Ubuntu 22.04 avec des IP publiques pour l'accès SSH :

- la **VM source PostgreSQL** (tag `postgres`) exécutant PostgreSQL 14 avec une base de données `petclinic` préremplie,
- la **VM source Tomcat** (tag `tomcat`) exécutant Apache Tomcat 10 avec l'application Spring PetClinic, accessible sur le port 8080, et
- la **VM de poste de travail de migration** dotée d'un grand disque de démarrage pour contenir les copies des systèmes de fichiers sources.

- **Console :** Compute Engine → Instances de VM. Utilisez le bouton SSH, ou ouvrez la console série pour suivre le script de démarrage.
- **CLI :**
  ```bash
  gcloud compute instances list --project "$PROJECT"
  gcloud compute ssh <vm-name> --project "$PROJECT" --zone "$ZONE"
  # Confirm a VM's startup script finished:
  gcloud compute ssh <vm-name> --project "$PROJECT" --zone "$ZONE" \
    --command 'tail -5 /var/log/startup-script.log'
  ```

### C. GKE — la cible de la migration {#c-gke--the-migration-target}

Un cluster GKE standard zonal reçoit les conteneurs migrés. Son pool de nœuds par défaut est remplacé par un pool géré par le module, dimensionné par `gke_node_count` (3 par défaut) et `gke_node_machine_type` (`e2-medium` par défaut), dont les nœuds reçoivent le scope `cloud-platform` afin de pouvoir extraire des images et communiquer avec les autres API Google Cloud. Le cluster utilise un réseau de VPC natif avec des plages de pods et de services attribuées automatiquement.

- **Console :** Kubernetes Engine → Clusters pour le cluster et le pool de nœuds ; Charges de travail et Services et entrées pour les applications migrées une fois déployées.
- **CLI :**
  ```bash
  gcloud container clusters list --project "$PROJECT"
  gcloud container clusters get-credentials <cluster-name> --zone "$ZONE" --project "$PROJECT"
  kubectl get nodes
  kubectl get pods,svc,pvc -n default     # migrated workloads land in the default namespace
  ```

### D. Réseau VPC et pare-feu {#d-vpc-network--firewall}

Le module crée un VPC en mode automatique et les règles de pare-feu dont le lab a besoin : trafic interne entre instances, SSH (22) et ICMP depuis n'importe où, et HTTP sur le port 8080 vers les instances portant le tag `tomcat` afin que l'application PetClinic soit consultable. Le poste de travail de migration atteint les VM sources via ce réseau interne pour copier leurs systèmes de fichiers.

- **Console :** Réseau VPC → Réseaux VPC pour le réseau ; Réseau VPC → Pare-feu pour les règles.
- **CLI :**
  ```bash
  gcloud compute networks list --project "$PROJECT"
  gcloud compute firewall-rules list --project "$PROJECT" --filter="network~mig-"
  ```

---

## 3. Comportement {#3-behaviour}

**Ce qui est provisionné lors de l'apply.** Un seul apply construit l'environnement complet : le VPC et les règles de pare-feu, les trois VM Compute Engine (chacune avec un script de démarrage qui installe et configure ses logiciels) et le cluster GKE avec son pool de nœuds. Les API de projet requises (Compute, GKE, Artifact Registry, Container Registry, IAM, Resource Manager, Storage, Logging, Monitoring) sont activées automatiquement lorsque `enable_services` reste activé.

**Configuration au premier démarrage.** Les scripts de démarrage des VM effectuent un travail réel et prennent du temps :

- La VM PostgreSQL installe PostgreSQL 14, crée la base de données `petclinic`, définit le mot de passe de l'utilisateur `postgres`, ouvre le serveur aux connexions distantes et installe la CLI d'évaluation `mcdc` ainsi qu'un utilitaire `/assess_mcdc.sh`.
- La VM Tomcat installe Java 17, Maven et Tomcat 10, clone et construit le WAR Spring PetClinic, le déploie, et installe `mcdc` et `/assess_mcdc.sh`. Elle fait pointer l'application vers la VM PostgreSQL en ajoutant l'IP interne de celle-ci à `/etc/hosts` sous le nom `petclinic-postgres`.
- La VM de poste de travail installe Docker, la CLI `m2c`, `kubectl`, Skaffold et le plug-in d'authentification GKE, et écrit des scripts utilitaires (`/install_container_tools.sh`, un fichier d'exclusion de copie `filters.txt` et un répertoire de travail).

**Le workflow de migration (piloté par l'opérateur).** Une fois l'infrastructure en place, l'opérateur effectue la migration manuellement depuis la VM de poste de travail. Le flux de bout en bout est le suivant :

1. **Évaluer** chaque VM source avec `mcdc` (exécutez `/assess_mcdc.sh`) pour confirmer qu'elle est prête à être conteneurisée et identifier les ports utilisés par chaque charge de travail.
2. **Copier** le système de fichiers d'une VM source vers le poste de travail avec `m2c copy` (utilise rsync via SSH — la VM source continue de s'exécuter et n'est jamais modifiée).
3. **Analyser** la copie avec `m2c analyze` pour produire un plan de migration, puis le personnaliser (nom de l'image, points de terminaison exposés, chemins des volumes persistants).
4. **Migrer les données** des charges de travail avec état avec `m2c migrate-data`, qui crée et alimente une PersistentVolumeClaim GKE.
5. **Générer** des Dockerfiles, des manifestes Kubernetes et une configuration Skaffold avec `m2c generate`.
6. **Déployer** sur GKE avec `skaffold run`, puis exploiter les charges de travail avec les outils Kubernetes natifs (mise à l'échelle, Horizontal Pod Autoscaling, mises à jour progressives).

**Suivi manuel effectué par l'opérateur.** Toutes les étapes M2C ci-dessus sont manuelles et sont documentées en détail dans le guide du lab. Le module fournit uniquement l'environnement et les scripts pratiques ; il n'orchestre pas la migration.

**Comportement lors du nettoyage.** La destruction du module supprime tout ce qu'il a créé — les VM, le cluster GKE et son pool de nœuds, les règles de pare-feu et le VPC. Deux éléments ne sont **pas** nettoyés automatiquement : les images de conteneur que vous avez poussées vers Artifact Registry / Container Registry pendant le lab (supprimez-les manuellement), et les PersistentVolumeClaims que vous avez créées (elles sont supprimées lors de la destruction du cluster, mais doivent être supprimées à la main si vous conservez le cluster).

**Remarques sur l'exécution.** Les versions de la chaîne d'outils de migration sont récupérées depuis des points de terminaison publics au démarrage ; si un point de terminaison est brièvement indisponible, une étape d'installation peut être ignorée sans aucun message ; vérifiez donc avec `/install_container_tools.sh` avant de commencer. L'application Tomcat rétablit d'elle-même sa connexion à la base de données une fois l'initialisation de PostgreSQL terminée ; une erreur de connexion transitoire juste après le déploiement est donc attendue.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et emplacement {#group-1--project--location}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. Doit déjà exister. |
| `tenant_id` | `demo` | Métadonnée uniquement — acceptée et validée (1-20 lettres minuscules, chiffres, traits d'union) mais référencée par aucune ressource de ce module. Les noms des ressources utilisent `deployment_id`, et non `tenant_id`. |
| `region` | `us-central1` | Métadonnée uniquement — aucune ressource de ce module ne référence `region`. Chaque ressource est placée selon `zone`. |
| `zone` | `us-central1-a` | Zone des VM et du cluster GKE. C'est la seule entrée d'emplacement qui ait un effet. |

### Groupe 3 — Réseau {#group-3--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_vpc` | `true` | Créer un nouveau VPC en mode automatique pour le lab. Ne définissez `false` que si un VPC nommé `mig-<id>-vpc` existe déjà. |
| `create_default_firewall_rules` | `true` | Créer les règles allow-internal, allow-SSH et allow-ICMP. Désactivez cette option si des règles équivalentes existent déjà. |
| `internal_traffic_cidr` | `10.128.0.0/9` | Plage source de la règle allow-internal. Correspond à la plage des sous-réseaux en mode automatique ; à remplacer pour un VPC en mode personnalisé. |

### Groupe 4 — VM sources {#group-4--source-vms}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `postgres_machine_type` | `e2-medium` | Type de machine de la VM source PostgreSQL 14. |
| `postgres_disk_size_gb` | `20` | Taille du disque de démarrage (Go) de la VM PostgreSQL ; 20 Go minimum recommandés. |
| `tomcat_machine_type` | `e2-medium` | Type de machine de la VM source Tomcat 10 / PetClinic. |
| `tomcat_disk_size_gb` | `20` | Taille du disque de démarrage (Go) de la VM Tomcat ; 20 Go minimum recommandés. |

### Groupe 5 — VM CLI Migrate to Containers {#group-5--migrate-to-containers-cli-vm}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `m2c_machine_type` | `e2-standard-4` | Type de machine de la VM de poste de travail. Nécessite suffisamment de CPU/mémoire pour copier et analyser les systèmes de fichiers sources. |
| `m2c_disk_size_gb` | `200` | Taille du disque de démarrage (Go). Doit contenir les copies des systèmes de fichiers des VM sources plus un espace de travail ; la valeur par défaut généreuse est intentionnelle. |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_node_machine_type` | `e2-medium` | Type de machine du pool de nœuds GKE qui exécute les charges de travail migrées. |
| `gke_node_count` | `3` | Nombre de nœuds ; 3 permettent d'exécuter à la fois un StatefulSet et un Deployment pendant le lab. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer l'environnement.

| Sortie | Description |
|---|---|
| `deployment_id` | Le suffixe de déploiement utilisé dans tous les noms de ressources. |
| `project_id` | ID du projet GCP. |
| `gke_cluster_name` | Nom du cluster GKE qui reçoit les charges de travail migrées. |
| `gke_cluster_location` | Zone dans laquelle le cluster GKE est déployé. |
| `postgres_vm_name` | Nom d'instance de la VM source PostgreSQL. |
| `postgres_vm_internal_ip` | IP interne de la VM source PostgreSQL. |
| `tomcat_vm_name` | Nom d'instance de la VM source Tomcat. |
| `tomcat_vm_external_ip` | IP externe de la VM Tomcat (consultez PetClinic sur le port 8080). |
| `m2c_cli_vm_name` | Nom d'instance de la VM de poste de travail de migration. |
| `petclinic_url` | URL complète, à ouvrir dans un navigateur, de l'application PetClinic sur la VM Tomcat. |
| `vpc_name` | Nom du réseau VPC créé pour le lab. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `deployment_id` | défini une seule fois | Critical | Intégré à chaque nom de ressource. Le modifier après le déploiement force la recréation du VPC, des VM et du cluster GKE. |
| `create_vpc` | `true` | High | Définir `false` exige un VPC préexistant nommé exactement `mig-<id>-vpc` — aucune variable ne permet de désigner un réseau nommé différemment ; l'apply échoue donc s'il est absent. |
| `zone` | zone valide et disponible | High | Toutes les VM et le cluster GKE sont déployés dans `zone` ; une zone invalide ou à capacité limitée fait échouer l'apply. `region` étant inerte, une `zone` en dehors de `region` est sans conséquence. |
| `m2c_disk_size_gb` | `200` | High | Un disque de poste de travail trop petit ne peut pas contenir les systèmes de fichiers sources copiés, et `m2c copy` échoue en cours de route. |
| `enable_services` | `true` | High | Si les API requises ne sont pas déjà activées et que ce paramètre vaut `false`, la création des ressources échoue immédiatement. Ne le désactivez que lorsque toutes les API requises sont confirmées comme activées. |
| `gke_node_count` | `3` | Medium | Avec moins de 3 nœuds, un StatefulSet et un Deployment migrés peuvent ne pas pouvoir être planifiés ensemble pendant le lab. |
| `create_default_firewall_rules` | `true` | Medium | Sans la règle allow-internal, le poste de travail ne peut pas atteindre les VM sources pour copier leurs systèmes de fichiers ; sans allow-SSH, vous ne pouvez pas vous connecter pour piloter le lab. |
| `postgres_disk_size_gb` / `tomcat_disk_size_gb` | `20`+ | Medium | Des disques de démarrage sous-dimensionnés peuvent manquer d'espace pendant la configuration de PostgreSQL ou le build Maven de PetClinic. |
| Portée du pare-feu SSH / Tomcat | à restreindre pour les projets partagés | Medium | SSH (22) et Tomcat (8080) sont ouverts à `0.0.0.0/0` par défaut — acceptable pour un lab de courte durée, mais resserrez les plages sources dans les projets durables ou partagés. |
| Images et PVC construits pendant le lab | à nettoyer manuellement | Low | Les images poussées pendant le lab et les PVC conservés ne sont pas supprimés par la destruction et continuent d'engendrer des coûts de stockage jusqu'à leur suppression. |

---

Pour la procédure complète destinée à l'opérateur — évaluation, copie/analyse, migration des données, génération des manifestes, déploiement sur GKE et exploitation au quotidien — consultez le **[guide du lab](https://docs.radmodules.dev/docs/labs/Container_Migration)**.
