---
title: "Wallos sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Wallos sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Wallos_GKE.md @ 3055034 sha256:8f1d95256679 -->

# Wallos sur GKE Autopilot — Guide de lab {#wallos-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallos_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Wallos est un outil open source et auto-hébergé de suivi des abonnements et des dépenses récurrentes,
construit en PHP 8.3 + php-fpm simple — il suit les abonnements récurrents, convertit
les prix entre devises, envoie des notifications de renouvellement et prend en charge un mode
multi-utilisateur pour un foyer, sans base de données externe. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Wallos on GKE Autopilot** sur Google Cloud :
le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les
problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Wallos. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallos_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, y compris la
  connexion administrateur par défaut.
- Comprendre pourquoi ce module est fixé à un seul réplica toujours actif et ne doit
  jamais être réduit à zéro ni dépasser un réplica.
- Effectuer les opérations du jour 2 — inspecter la charge de travail, comprendre la répartition du stockage entre
  PVC HDD et GCS FUSE, et gérer l'ingress.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Wallos (GKE)**
   depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Wallos_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que `min_instance_count`,
   `max_instance_count` et `stateful_pvc_enabled` sont tous fixés à leurs
   valeurs par défaut raisonnables (`1`, `1`, `true`) pour une vraie raison — consultez la tâche 3 avant
   de les modifier. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un
   StatefulSet avec un PVC en mode bloc HDD (par défaut) monté sur `/var/www/html/db` pour
   la base de données SQLite, ainsi qu'un bucket GCS FUSE monté sur
   `/var/www/html/images/uploads/logos` pour les logos personnalisés des fournisseurs, puis récupère
   l'image préconstruite `bellamy/wallos`. Il n'y a ni instance Cloud SQL, ni
   secret applicatif dans Secret Manager, ni tâche d'initialisation de la base de données — Wallos
   est autonome. Les premiers déploiements se terminent généralement en **10–15 minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep wallos | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute (un StatefulSet à réplica unique par défaut) et
   trouvez son adresse :

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Le Service est par défaut de type `LoadBalancer` (Wallos est une interface web pilotée depuis un navigateur) ;
   une IP externe devrait donc apparaître dès que la charge de travail est Ready.

2. Vérifiez que le service est en bonne santé. Wallos ne documente aucun point de terminaison de santé dédié ;
   la sonde (et cette vérification) interroge donc la page de connexion sur `/` :

   ```bash
   kubectl exec -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- wget -qO- -S http://localhost:80/ 2>&1 | head -1
   ```

3. Ouvrez la charge de travail dans un navigateur — via l'IP externe ou le domaine personnalisé, ou via une
   redirection de port :

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8080:80
   # then browse to http://localhost:8080
   ```

   Connectez-vous avec l'identifiant par défaut initialisé **`admin` / `admin`**. Changez immédiatement
   le mot de passe sous **Settings → Account** — cet identifiant est
   bien connu et donne le contrôle total des données d'abonnement.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, les pods et les PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez jamais un réplica et ne réduisez jamais à zéro.** C'est plus strict
   que la règle empirique habituelle « éviter les démarrages à froid » — Wallos exécute un véritable
   démon cron toujours actif (8 tâches planifiées intégrées : actualisation des taux de change,
   notifications de renouvellement, une interrogation de vérification d'e-mail toutes les 2 minutes, et d'autres)
   qui ne se déclenche que lorsqu'un pod s'exécute, et sa base de données SQLite ne prend pas en charge
   plusieurs écrivains. Laissez `min_instance_count = max_instance_count = 1` dans
   la plateforme RAD ; un `kubectl scale` manuel serait de toute façon annulé lors de la prochaine application,
   et une réduction à zéro arrête silencieusement toutes les tâches planifiées sans aucune erreur.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; `bellamy/wallos` est récupérée à nouveau, et
   une mise à jour progressive remplace le pod.

4. **Ajustez l'ingress** — basculez `enable_custom_domain` / `application_domains`,
   puis appliquez via **Update**. Évitez de désactiver `stateful_pvc_enabled` sauf si vous
   avez une raison précise — cela ramène la base de données d'un véritable PVC en mode bloc vers
   un montage GCS FUSE, moins adapté aux besoins de verrouillage en écriture de SQLite.

5. **Inspectez l'état persistant :**

   ```bash
   # Database (default: block PVC)
   kubectl get pvc -n "$NS"

   # Uploads (always GCS FUSE)
   gcloud storage buckets list --project="$PROJECT" --filter="name~wallos"
   gcloud storage ls gs://<uploads-bucket>/
   ```

   Ne supprimez jamais le PVC de la base de données ni le bucket `uploads` — cela détruirait
   définitivement cet état.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer). Comme le démon cron de Wallos
   s'exécute dans le processus, l'activité de ses tâches planifiées n'est visible qu'ici (il n'existe
   pas de CronJob distinct pour lui) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods ainsi que le nombre de redémarrages (il doit rester un seul pod stable).
   Si `uptime_check_config` est activé, consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Wallos.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et de
  liveness ciblent `/` ; un échec de montage ou une image défectueuse empêchera le pod de
  devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Permission refusée lors de l'écriture sur le PVC de la base de données :** l'UID/GID d'exécution de `bellamy/wallos`
  n'a pas été confirmé lors des recherches ; `stateful_fs_group` n'est donc pas défini par défaut.
  Inspectez le conteneur en cours d'exécution pour trouver l'UID/GID réel et définissez
  `stateful_fs_group` en conséquence.
  ```bash
  kubectl exec -n "$NS" <pod> -- id
  ```
- **Double montage sur le chemin de la base de données :** si vous avez modifié `stateful_pvc_enabled`,
  vérifiez que `enable_gcs_db_volume` a bien été désactivé automatiquement par `Wallos_Common`
  (les deux montés en même temps constituent une erreur de configuration, et non un état pris en charge).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # check Volumes / Mounts section
  ```
- **État non persisté entre les redémarrages :** vérifiez que `stateful_pvc_mount_path` vaut
  exactement `/var/www/html/db` ; une différence stocke la base de données sur un disque éphémère et
  perd l'état au redémarrage.
- **Les notifications de renouvellement ou les mises à jour des taux de change n'arrivent plus :** cela
  signifie presque toujours que la charge de travail a été réduite à zéro ou étendue au-delà d'un réplica —
  vérifiez d'abord `min_instance_count`/`max_instance_count`, avant de supposer un
  bogue au niveau de l'application.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de
  ressources ou de quotas, et vérifiez que le Service/Ingress dispose d'une IP attribuée si
  `enable_custom_domain = true`.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry (si elle est
  mise en miroir) et que le compte de service des nœuds peut la récupérer ; les images en miroir utilisent
  `imagePullPolicy = Always`, un cache local obsolète n'est donc pas en cause — vérifiez plutôt le
  registre et IAM.
- **La connexion indique que `admin`/`admin` est toujours actif après un redéploiement :** c'est attendu si aucune
  base SQLite n'existait auparavant à `/var/www/html/db/wallos.db`. Si une invite admin/admin vierge
  apparaît de manière inattendue sur un déploiement déjà configuré, vérifiez
  si le PVC ou le bucket GCS a été remplacé ou vidé.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de conserver `min_instance_count = max_instance_count
= 1`, de ne jamais supprimer le PVC de la base de données ni le bucket `uploads`, et de laisser Common gérer
l'exclusivité GCS-FUSE/PVC pour le chemin de la base de données).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — la charge de travail Kubernetes et son espace de noms, le PVC de la base de données et le bucket GCS `uploads` (y compris la base de données SQLite intégrée et les logos personnalisés — c'est destructif et irrécupérable) et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, l'Artifact Registry partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail StatefulSet GKE, un PVC HDD pour la base de données et un bucket GCS pour les fichiers envoyés ; pas de Cloud SQL, pas de tâche d'initialisation |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ; la vérification d'état réussit ; se connecter avec l'identifiant initialisé `admin`/`admin` et changer immédiatement le mot de passe |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, maintenir exactement 1 réplica, mettre à jour la version, ajuster l'ingress, inspecter l'état persistant |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de montage, d'autorisations du PVC, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime la charge de travail, le PVC de la base de données et le bucket des fichiers envoyés (destructif) |
