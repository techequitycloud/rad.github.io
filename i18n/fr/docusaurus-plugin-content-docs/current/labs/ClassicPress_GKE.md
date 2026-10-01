---
title: "ClassicPress sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez ClassicPress sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/ClassicPress_GKE.md @ 3055034 sha256:90cc25e7cd97 -->

# ClassicPress sur GKE Autopilot — Guide de lab {#classicpress-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/ClassicPress_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

ClassicPress est un CMS libre et open source orienté entreprise — un fork léger de
WordPress 4.9.x qui préserve l'expérience d'édition classique (antérieure à Gutenberg), avec
extensions, thèmes, médiathèque et API REST. Ce lab vous fait parcourir tout le cycle
de vie opérationnel du module **ClassicPress on GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités de ClassicPress. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/ClassicPress_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et terminer l'installateur initial de ClassicPress.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Comprendre comment le PVC du StatefulSet et le montage NFS de `wp-content` assurent ensemble
  la persistance sur GKE.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **ClassicPress (GKE)**
   dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/ClassicPress_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme construit une image personnalisée légère (`FROM classicpress/classicpress`) via
   Cloud Build, déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un
   **StatefulSet** avec, par pod, un PVC en mode bloc `standard-rwo` de 10Gi monté sur
   `/var/www/html`, provisionne une base de données Cloud SQL for MySQL 8.0 avec ses secrets
   Secret Manager (`CLASSICPRESS_SALT_SEED` et le mot de passe de la base de données), une
   instance Filestore (NFS) (`enable_nfs = true` par défaut), un bucket Cloud Storage
   `classicpress-uploads`, puis exécute un job ponctuel d'initialisation de la base de données (`db-init`)
   qui crée la base de données de l'application et son utilisateur. Un premier déploiement prend environ
   **20 à 35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep classicpress | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse externe :

   ```bash
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est accessible :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   # expect 200 (already installed) or 302 (redirect to the first-run installer)
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Sur une base de données vierge, ClassicPress
   redirige vers `/wp-admin/install.php` — terminez l'installateur (titre du site, nom
   d'utilisateur administrateur, mot de passe et adresse e-mail) pour créer le schéma et le compte administrateur. Il
   n'existe **aucun identifiant administrateur pré-renseigné** dans Secret Manager ; l'installateur est le seul
   moyen d'en définir un. Comme l'installation réside sur le PVC du StatefulSet (et non sur le stockage
   éphémère du conteneur), elle persiste d'un redémarrage de pod à l'autre une fois créée.

4. Connectez-vous sur `http://${EXTERNAL_IP}/wp-login.php` avec le compte que vous venez de créer
   et vérifiez que le tableau de bord se charge.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pods et PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module possède la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de la prochaine application). Conservez `max_instance_count = 1` : `stateful_pvc_enabled
   = true` donne à chaque pod du StatefulSet son **propre** PVC ; un second réplica exécuterait donc
   sa propre copie distincte et non synchronisée de l'installation au lieu de la partager.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive
   remplace le pod. Les applications adossées à NFS utilisent normalement la stratégie de déploiement `Recreate` sur
   cette fondation, mais la persistance principale de ClassicPress repose ici sur le PVC, et non sur NFS —
   vérifiez que le déploiement progressif se termine proprement :

   ```bash
   kubectl rollout status statefulset/<service-name> -n "$NS"
   ```

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~classicpress"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. classicpressdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^classicpress" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Comment cette variante assure la persistance des fichiers téléversés, extensions et thèmes.** Sur **GKE**, le
   *module applicatif* (et non la couche Common) définit `stateful_pvc_enabled = true`
   avec `stateful_pvc_mount_path = /var/www/html` — le répertoire exact dans lequel le point d'entrée amont
   écrit `wp-config.php` et copie l'ensemble de l'application — si bien que
   toute l'installation (code, extensions, thèmes et fichiers téléversés) persiste d'un redémarrage
   ou d'une replanification de pod à l'autre sur un PVC en mode bloc propre à chaque pod. `enable_nfs = true` est également la
   valeur par défaut ici ; il monte Filestore sur `/var/www/html/wp-content` — un sous-répertoire
   du montage PVC ci-dessus. ClassicPress (un fork de WordPress) lit et écrit les médias
   téléversés, les extensions et les thèmes sous `wp-content`, et la logique de copie au premier démarrage
   du point d'entrée amont ignore explicitement un répertoire `wp-content` existant ; ce
   montage NFS constitue donc lui aussi un véritable chemin de persistance confirmé pour ces données — et non
   un stockage de réserve inutilisé. Sur un StatefulSet à un seul réplica, le PVC suffit déjà à
   assurer la persistance ; NFS fournit en plus une copie *partagée* (et non propre à chaque pod) de
   `wp-content`, ce qui compte si `stateful_pvc_enabled` est un jour désactivé ou si la
   charge de travail passe à plusieurs réplicas. **Cloud Run** (sans volume en mode bloc par
   instance) s'appuie sur ce même montage NFS sur `/var/www/html/wp-content` comme
   mécanisme de persistance principal pour les fichiers téléversés, extensions et thèmes — voir le
   [lab ClassicPress_CloudRun](https://docs.radmodules.dev/docs/labs/ClassicPress_CloudRun).

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Vérifiez aussi l'utilisation du PVC
   sous Kubernetes Engine → Storage à mesure que la médiathèque grandit. Le module peut
   provisionner un test de disponibilité (uptime check, lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de ClassicPress.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de démarrage
  est de type TCP sur le port 80 avec un `failure_threshold = 20` généreux, ce qui laisse au
  point d'entrée amont le temps de remplir un PVC vide au premier démarrage ; la sonde de vivacité (liveness) est
  un `GET /` HTTP avec un délai initial de 300 secondes.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Le site réaffiche de manière inattendue l'installateur initial :** sur cette variante,
  l'installation réside sur le PVC du StatefulSet ; cela ne devrait donc pas se produire lors de redémarrages
  ordinaires de pod — si c'est le cas, vérifiez si le PVC a été recréé (un PVC supprimé ou remplacé
  perd toute l'installation, y compris `wp-config.php`) plutôt que de supposer qu'il s'agit du
  même bogue de démarrage à froid que celui documenté pour Cloud Run :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE` et
  que le job `db-init` s'est terminé. Les pods atteignent Cloud SQL via le sidecar Auth Proxy
  sur `127.0.0.1:3306` (`enable_cloudsql_volume = true`, obligatoire sur GKE) —
  aucune IP publique n'est exposée.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes
  de ressources ou de quota (y compris le quota `SSD_TOTAL_GB` que consomme le PVC `standard-rwo`
  par défaut), et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de
  service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler
`CLASSICPRESS_SALT_SEED` après le premier démarrage, et le compromis de quota SSD contre HDD lié à
`stateful_pvc_storage_class`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes,
son espace de noms et son PVC, la base de données Cloud SQL, les secrets Secret Manager, l'instance Filestore,
le bucket GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, le cluster GKE, l'instance Cloud SQL partagée, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie le StatefulSet GKE + PVC, Cloud SQL (MySQL 8.0), Filestore, les secrets et le bucket de stockage, et exécute `db-init` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'accessibilité réussit ; terminer l'installateur initial pour créer le compte administrateur |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base ; comprendre comment le PVC et le montage NFS de `wp-content` assurent ensemble la persistance |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et l'utilisation du PVC |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
