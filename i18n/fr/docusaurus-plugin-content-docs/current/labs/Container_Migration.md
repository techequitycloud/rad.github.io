---
title: "Migrate to Containers sur GKE — Guide de lab"
description: "Lab pratique : migrez des charges de travail de VM vers des conteneurs sur GKE avec Migrate to Containers — évaluation, migration, vérification et démantèlement."
---

<!-- translated-from: docs/labs/Container_Migration.md @ 3055034 sha256:c8aa85a6fd07 -->

# Migrate to Containers sur GKE — Guide de lab {#migrate-to-containers-on-gke--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Container_Migration)**

## Vue d'ensemble {#overview}

**Durée estimée :** 90–150 minutes

**Migrate to Containers (M2C)** est la voie proposée par Google Cloud pour transférer des charges de travail Linux
basées sur des VM vers des conteneurs sur Google Kubernetes Engine sans modifier le code source des applications.
Ce lab vous guide à travers le cycle de vie complet du module **Migrate to Containers on GKE** :
déployer l'environnement, y accéder et le vérifier, réaliser une véritable migration au quotidien, observer les
résultats, diagnostiquer les problèmes courants et le démanteler.

Le module est un **bac à sable de migration autonome**. Il provisionne deux VM sources exécutant de vraies
applications (une base de données PostgreSQL 14 et un serveur Apache Tomcat 10 hébergeant l'application Spring
PetClinic), une VM de poste de travail de migration préchargée avec la chaîne d'outils M2C, et un cluster GKE
prêt à recevoir les charges de travail migrées. La migration elle-même est effectuée par vous, à la main, sur la
VM de poste de travail.

Ce lab porte sur l'exploitation du **module et de la plateforme Google Cloud**. Pour la liste complète
des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Container_Migration) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer l'environnement de migration depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter aux VM sources, au poste de travail et au cluster GKE, et vérifier que les outils sont prêts.
- Réaliser une migration de bout en bout : évaluer une VM, la copier et l'analyser, migrer les données, générer les manifestes et déployer sur GKE.
- Observer les charges de travail sources et les conteneurs migrés avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de migration et de déploiement les plus courants.
- Démanteler proprement l'environnement.

## Prérequis {#prerequisites}

- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Votre propre projet uniquement.** Ce module masque l'option **GCP Project on RAD** (`enable_rad_gcpproject = false`) parce qu'il active `containerregistry`, que les listes d'autorisation sandbox et development gérées par RAD n'incluent pas ; il se déploie donc toujours dans un projet que vous apportez. Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
export ZONE="us-central1-a"           # must lie within REGION
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Migrate to Containers (GKE)**
   dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Container_Migration)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme crée le VPC et les règles de pare-feu, les deux VM sources (PostgreSQL et
   Tomcat/PetClinic), la VM de poste de travail de migration et le cluster GKE. Chaque VM exécute ensuite un
   script de démarrage au premier boot qui installe et configure ses logiciels (configuration de PostgreSQL, un
   build Maven de PetClinic et le téléchargement de la chaîne d'outils de migration). Les premiers déploiements prennent
   environ **15–25 minutes**, après quoi prévoyez encore **5–10 minutes** pour que les scripts de démarrage
   des VM se terminent.

3. Relevez les noms des ressources clés dans les **Outputs** (sorties) du déploiement (affichés sur la page de
   détails du déploiement) : `postgres_vm_name`, `tomcat_vm_name`, `m2c_cli_vm_name`,
   `gke_cluster_name` et `petclinic_url`.

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que les trois VM existent et s'exécutent :

   ```bash
   gcloud compute instances list --project "$PROJECT" --filter="name~mig-"
   ```

2. Vérifiez que l'application source fonctionne **avant** de migrer quoi que ce soit — ouvrez
   la valeur `petclinic_url` des Outputs dans un navigateur (l'adresse IP externe de la VM Tomcat sur le port 8080).
   L'application Spring PetClinic doit se charger et lire les données de la VM PostgreSQL.

3. Connectez-vous en SSH à la VM de poste de travail et vérifiez que la chaîne d'outils de migration est installée :

   ```bash
   M2C_VM=$(gcloud compute instances list --project "$PROJECT" \
     --filter="name~mig- AND name~m2c" --format="value(name)" --limit=1)
   gcloud compute ssh "$M2C_VM" --project "$PROJECT" --zone "$ZONE" \
     --command 'sudo /install_container_tools.sh'
   ```

   Chaque ligne doit indiquer `[✓]` pour `m2c`, `kubectl`, `skaffold`, `gke-gcloud-auth-plugin`
   et Docker. Si l'une d'elles affiche `[✗]`, attendez deux minutes (le script de démarrage est peut-être encore en cours)
   et relancez la commande.

4. Vérifiez que le cluster GKE est prêt à recevoir des charges de travail :

   ```bash
   CLUSTER=$(gcloud container clusters list --project "$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --zone "$ZONE" --project "$PROJECT"
   kubectl get nodes
   ```

---

## Tâche 3 — Exploiter : réaliser une migration (jour 2) [Manuel] {#task-3--operate-run-a-migration-day-2-manual}

C'est le cœur du lab — réalisé à la main sur la VM de poste de travail. Les étapes ci-dessous décrivent
le **flux de travail** de migration ; les options de commande exactes et les modifications de manifestes figurent dans le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Container_Migration) et dans la
documentation de Migrate to Containers. Connectez-vous en SSH à la VM de poste de travail pour toutes ces étapes :

```bash
gcloud compute ssh "$M2C_VM" --project "$PROJECT" --zone "$ZONE"
```

1. **Évaluez** chaque VM source. Exécutez l'utilitaire fourni sur les VM PostgreSQL et Tomcat pour
   collecter les données système avec `mcdc` et produire un rapport d'aptitude à la conteneurisation. Notez les
   ports utilisés par chaque charge de travail (PostgreSQL 5432, Tomcat 8080) — vous les déclarerez plus tard comme
   points de terminaison du conteneur.

2. **Copiez** le système de fichiers d'une VM source vers le poste de travail avec `m2c copy`. Cette commande utilise rsync via
   SSH ; la VM source continue de s'exécuter et n'est jamais modifiée. Le fichier `filters.txt` du poste de travail
   exclut de la copie les chemins éphémères (`/proc`, `/sys`, `/dev`, journaux).

3. **Analysez** la copie avec `m2c analyze` pour produire un plan de migration, puis personnalisez-le : définissez un
   nom d'image de conteneur explicite, déclarez le ou les points de terminaison du service et (pour la charge de travail
   PostgreSQL avec état) confirmez le chemin du répertoire de données qui deviendra un PersistentVolume.

4. **Migrez les données** de la charge de travail PostgreSQL avec état avec `m2c migrate-data`, qui crée
   et remplit un PersistentVolumeClaim GKE. Vérifiez qu'il atteint l'état `Bound` :

   ```bash
   kubectl get pvc -n default
   ```

5. **Générez** le Dockerfile, les manifestes Kubernetes et la configuration Skaffold avec `m2c generate`.
   La charge de travail PostgreSQL génère un StatefulSet ; la charge de travail Tomcat sans état génère un
   Deployment avec un Service LoadBalancer.

6. **Déployez** chaque charge de travail sur GKE avec `skaffold run`, en déployant PostgreSQL en premier afin que la
   base de données soit disponible avant le démarrage de PetClinic. Parcourez ensuite le PetClinic migré via l'adresse
   IP externe du Service Tomcat :

   ```bash
   kubectl get pods,svc,pvc -n default
   ```

7. **Opérations du jour 2.** Une fois migrées, les charges de travail se gèrent avec Kubernetes natif —
   mettez à l'échelle le Deployment Tomcat, associez-lui un Horizontal Pod Autoscaler et configurez une stratégie de
   mise à jour progressive, le tout sur le cluster GKE.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Démarrage des VM sources** — vérifiez que le script de premier démarrage de chaque VM s'est terminé :

   ```bash
   for VM in $(gcloud compute instances list --project "$PROJECT" \
     --filter="name~mig-" --format="value(name)"); do
     echo "== $VM =="
     gcloud compute ssh "$VM" --project "$PROJECT" --zone "$ZONE" \
       --command 'tail -3 /var/log/startup-script.log'
   done
   ```

2. **Charges de travail migrées** — consultez les journaux et les événements des pods depuis le cluster GKE :

   ```bash
   kubectl get pods -n default
   kubectl logs <pod-name> -n default --tail=50
   ```

3. **Cloud Monitoring** — ouvrez les tableaux de bord Compute Engine et GKE / Kubernetes pour examiner l'utilisation
   du CPU et de la mémoire des VM et des nœuds, ainsi que le nombre de redémarrages et les métriques de requêtes des
   charges de travail migrées. Les journaux sont également disponibles dans **Logging → Logs Explorer**.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement :

- **La chaîne d'outils affiche `[✗]` :** le script de démarrage récupère `m2c`/`kubectl`/Skaffold depuis des points
  de terminaison publics au démarrage. Attendez quelques minutes et relancez `/install_container_tools.sh` ; consultez
  `/var/log/startup-script.log` sur la VM de poste de travail pour identifier le téléchargement en échec.
- **`m2c copy` échoue (erreur SSH/rsync) :** vérifiez que le poste de travail et les VM sources se trouvent dans le même
  VPC, que la règle de pare-feu allow-internal existe et que la VM source s'exécute
  (`gcloud compute instances list --filter="status=RUNNING"`).
- **PVC bloqué en `Pending` après la migration des données :** consultez `kubectl get storageclass` et
  `kubectl describe pvc -n default` pour en trouver la cause (souvent une StorageClass par défaut manquante).
- **Pod migré en `CrashLoopBackOff` :** inspectez les journaux et les événements et, pour PostgreSQL, vérifiez que
  le PVC contient le répertoire de données attendu :
  ```bash
  kubectl logs <pod> -n default --previous
  kubectl describe pod <pod> -n default
  ```
- **PetClinic ne parvient pas à joindre PostgreSQL :** vérifiez que le Service PostgreSQL existe dans le cluster et
  que le nom d'hôte de la base de données de l'application lui correspond.
- **Erreur d'authentification Docker de Skaffold :** relancez `gcloud auth configure-docker` sur la VM de poste de travail.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Cette opération supprime tout ce que le module a créé — les deux VM sources, la VM de poste
de travail de migration, le cluster GKE et son pool de nœuds, les règles de pare-feu et le VPC.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications
manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie
le déploiement).

Deux éléments **ne sont pas** supprimés automatiquement et doivent être nettoyés à la main si vous n'en avez plus
besoin : les images de conteneur que vous avez poussées vers Artifact Registry / Container Registry pendant le
lab, et les PersistentVolumeClaims (ils disparaissent lorsque le cluster est détruit, mais doivent être
supprimés manuellement si vous conservez le cluster).

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le VPC, deux VM sources, le poste de travail de migration et le cluster GKE |
| 2 — Accéder et vérifier | Manuel | L'application PetClinic source se charge ; la chaîne d'outils du poste de travail indique `[✓]` ; le cluster GKE est joignable |
| 3 — Exploiter | Manuel | Réaliser une migration : évaluer, copier, analyser, migrer les données, générer les manifestes, déployer sur GKE |
| 4 — Observer | Manuel | Vérifier le démarrage des VM ; examiner les journaux des charges de travail migrées et les métriques Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de chaîne d'outils, de copie, de PVC, de pod, de connectivité et d'authentification Skaffold |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module ; nettoyer à la main les images/PVC créés pendant le lab |
