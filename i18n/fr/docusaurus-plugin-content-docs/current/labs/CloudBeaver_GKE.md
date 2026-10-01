---
title: "CloudBeaver sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez CloudBeaver sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/CloudBeaver_GKE.md @ 3055034 sha256:469e58a56a68 -->

# CloudBeaver sur GKE Autopilot — Guide de lab {#cloudbeaver-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CloudBeaver_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

CloudBeaver est la console web d'administration de bases de données du projet DBeaver — une interface unique dans le navigateur pour se connecter à PostgreSQL, MySQL, SQL Server, Oracle et bien d'autres moteurs, et les interroger. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **CloudBeaver on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités de CloudBeaver. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/CloudBeaver_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution derrière son Service `ClusterIP` par défaut.
- Revendiquer le compte administrateur via l'assistant de configuration initiale et comprendre pourquoi le moment choisi compte.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet et son PVC en mode bloc, et mettre à jour la version.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **CloudBeaver (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CloudBeaver_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit l'image de conteneur (une enveloppe légère `FROM dbeaver/cloudbeaver`
   — sans point d'entrée personnalisé, le démarrage propre de l'image amont est utilisé tel quel), puis
   déploie un **StatefulSet** à réplique unique (port 8978, 1 vCPU / 1 GiB)
   dans le cluster GKE Autopilot, avec par pod un **Persistent Disk en mode bloc** monté sur
   `/opt/cloudbeaver/workspace`. Un bucket Cloud Storage est également déclaré par souci de cohérence
   avec la variante Cloud Run, mais ce n'est pas là que réside l'espace de travail. Il n'y a **ni
   instance Cloud SQL, ni Redis, ni secret applicatif** — CloudBeaver conserve tout
   son état sur le PVC en mode bloc. Un premier déploiement prend généralement **10 à 20 minutes**
   (le build du conteneur et le provisionnement du PVC dominent — il n'y a aucune base de données à
   attendre).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep cloudbeaver | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. **Commencez par tenir compte du type de Service.** Le module utilise par défaut `service_type = "ClusterIP"`
   — un choix adapté à une console d'administration de bases de données, mais qui signifie que la charge de travail n'est
   accessible que depuis l'intérieur du cluster. Vérifiez que la charge de travail s'exécute et regardez comment
   elle est exposée :

   ```bash
   kubectl get pods,svc,statefulset -n "$NS"
   ```

2. Pour un accès rapide sans modifier le déploiement, faites une redirection de port (port-forward) vers le Service :

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8978:8978
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8978/"   # expect 200
   ```

   Pour un accès durable depuis un navigateur à l'extérieur du cluster, définissez `service_type =
   "LoadBalancer"` via **Update** sur la page de détails du déploiement (ou ajoutez un domaine
   personnalisé avec IAP), puis repérez l'adresse externe :

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

3. Vérifiez que le service est en bonne santé. Le chemin de santé de CloudBeaver est `/`, qui renvoie
   HTTP 200 une fois le démarrage de la JVM terminé (la sonde de démarrage prévoit un délai
   initial de 15 secondes).

4. Ouvrez l'adresse accessible (URL de la redirection de port ou, une fois exposée, `http://${EXTERNAL_IP}`)
   dans un navigateur. Au premier accès, CloudBeaver présente son **assistant de configuration** — il n'existe
   aucun compte administrateur pré-créé, donc **la première personne qui termine l'assistant devient
   administrateur**. Terminez-le immédiatement : définissez le nom du serveur et créez le nom d'utilisateur
   et le mot de passe administrateur. Conservez le Service en `ClusterIP` (ou derrière IAP) tant que vous ne
   l'avez pas fait.

5. Après vous être connecté en tant qu'administrateur, ajoutez une connexion à une base de données (New Connection → choisissez le
   pilote → indiquez l'hôte, le port et les identifiants). Pour atteindre une base de données privée sur le VPC
   (y compris l'instance Cloud SQL partagée de Services_GCP), testez d'abord l'accessibilité depuis l'intérieur
   du pod :

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- sh -c 'nc -zv <db-private-ip> 5432'
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pods et PVC en mode bloc :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **N'augmentez pas le nombre d'instances.** Ce module utilise délibérément par défaut `min_instance_count = 1`
   (pour éviter les démarrages à froid lents de la JVM ; GKE ne réduit pas à zéro) et `max_instance_count = 1`.
   L'espace de travail est un **magasin à écrivain unique** (une base H2 embarquée sur le PVC
   en mode bloc) — porter `max_instance_count` au-delà de 1 risque de le corrompre. Les modifications de mise à l'échelle,
   comme toutes les modifications de spécification, passent par **Update** sur la page de détails du déploiement, et non par un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur
   la page de détails du déploiement ; une nouvelle image est construite à partir de `dbeaver/cloudbeaver:<version>`
   et une mise à jour progressive remplace le pod. Épinglez un tag précis plutôt que `latest` pour des
   déploiements reproductibles.

4. **Gérez le stockage et les jobs** — le PVC en mode bloc est le cœur durable du déploiement
   (connexions enregistrées, utilisateurs, paramètres, base de métadonnées embarquée). Il n'y a ni
   secret applicatif ni job d'initialisation à vérifier :

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" statefulset/<service-name> -- ls -la /opt/cloudbeaver/workspace
   kubectl get jobs -n "$NS"                          # expect none — CloudBeaver has no db-init job
   gcloud secrets list --project="$PROJECT" --filter="name~cloudbeaver"   # expect none
   ```

5. **Il n'y a aucune base de données applicative à gérer.** `database_type = "NONE"` — ni
   instance Cloud SQL, ni job db-init, ni secret de mot de passe de base de données. Les bases de données que
   CloudBeaver *administre* sont des cibles externes que vous enregistrez dans son interface.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods (surveillez la mémoire — CloudBeaver repose sur la JVM), le nombre de redémarrages et
   l'utilisation du PVC. Le module peut provisionner un **contrôle de disponibilité** (uptime check), mais uniquement lorsque le
   point de terminaison est accessible publiquement (par ex. `service_type = "LoadBalancer"`) — avec la
   valeur par défaut `ClusterIP`, il n'y a aucun point de terminaison public à sonder ; Monitoring → Uptime
   checks peut donc être légitimement vide.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de CloudBeaver.

- **Impossible d'atteindre le Service depuis votre machine :** c'est presque toujours dû au type de Service par défaut
  `ClusterIP`, et non à une panne. Utilisez `kubectl port-forward` (tâche 2) ou
  passez à `LoadBalancer` avant de conclure à une défaillance.
- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et
  de vivacité (liveness) ciblent `/` (l'interface web de CloudBeaver) ; un démarrage lent de la JVM ou un échec de montage
  du PVC de l'espace de travail empêchera le pod de passer à l'état Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **État de l'espace de travail manquant / paramètres réinitialisés :** vérifiez que le PVC en mode bloc existe et est
  lié (bound), et que `stateful_pvc_mount_path` correspond au répertoire d'espace de travail de CloudBeaver
  (`/opt/cloudbeaver/workspace`) — tout l'état de CloudBeaver s'y trouve, et non dans le bucket
  GCS.
  ```bash
  kubectl get pvc -n "$NS"
  ```
- **Espace de travail corrompu / erreurs de métadonnées étranges :** vérifiez si `max_instance_count`
  a été porté au-delà de 1 — deux pods écrivant simultanément dans le magasin H2 embarqué le corrompent.
  Restaurez à partir d'un instantané du PVC s'il en existe un.
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes
  de ressources ou de quota, et (si vous utilisez `LoadBalancer`) vérifiez que le Service a reçu une IP
  externe.
- **Impossible d'atteindre une base de données privée depuis l'interface :** vérifiez que la base de données cible est
  accessible sur le VPC depuis le pod (tâche 2, étape 5).
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de
  service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre, notamment la règle essentielle de conserver `max_instance_count = 1` et d'utiliser un
PVC en mode bloc (et non GCS FUSE) pour l'espace de travail.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes, le namespace et le PVC en mode bloc (et avec lui **toutes les connexions enregistrées, les utilisateurs et les paramètres**), le bucket Cloud Storage et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, l'instance Cloud SQL partagée, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image et provisionne un StatefulSet à réplique unique avec un espace de travail sur PVC en mode bloc (sans base de données, sans Redis, sans secrets) |
| 2 — Accéder et vérifier | Manuel | Comprendre le Service `ClusterIP` par défaut ; le contrôle de santé réussit ; revendiquer le compte administrateur via l'assistant de configuration |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet et le PVC, conserver une seule instance, mettre à jour la version |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring ; comprendre quand le contrôle de disponibilité existe |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'accessibilité du Service, de pod, de PVC de l'espace de travail, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC de l'espace de travail |
