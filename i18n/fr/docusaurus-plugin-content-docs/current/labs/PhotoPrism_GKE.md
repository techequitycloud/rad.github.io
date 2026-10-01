---
title: "PhotoPrism sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez PhotoPrism sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PhotoPrism_GKE.md @ 3055034 sha256:75340b8900ae -->

# PhotoPrism sur GKE Autopilot — Guide de lab {#photoprism-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhotoPrism_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

PhotoPrism est une application auto-hébergée de gestion de photos et de vidéos, dotée d'IA —
elle permet de parcourir, d'organiser et de partager une médiathèque personnelle avec un étiquetage automatique,
la reconnaissance faciale et la recherche plein texte/visuelle, le tout servi par un unique binaire Go
avec une base de données SQLite intégrée. Ce lab vous fait parcourir tout le cycle de vie opérationnel
du module **PhotoPrism on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de PhotoPrism. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/PhotoPrism_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder au StatefulSet en cours d'exécution, y compris sa
  Persistent Volume Claim en mode bloc.
- Effectuer les opérations du jour 2 — inspecter, gérer les secrets et sauvegarder la médiathèque.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
  PhotoPrism lui-même ne provisionne aucune instance Cloud SQL — il utilise une base de données SQLite
  intégrée sur une PVC en mode bloc.
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **PhotoPrism (GKE)** dans
   la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PhotoPrism_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que `stateful_pvc_storage_class`
   vaut par défaut `standard-rwo`, adossé à du SSD, qui puise dans le quota restreint `SSD_TOTAL_GB` —
   envisagez `standard` (HDD) si vous l'exécutez aux côtés d'autres modules avec état
   dans un projet aux quotas limités. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie PhotoPrism dans le cluster GKE Autopilot en tant que
   **StatefulSet** (fixé à exactement un réplica, `min=1`, `max=1`) avec une Persistent Volume Claim
   en mode bloc de 20Gi montée sur `/photoprism`, provisionne le secret Secret Manager
   `PHOTOPRISM_ADMIN_PASSWORD` généré automatiquement, puis construit et met en miroir
   l'image de conteneur. Un bucket Cloud Storage `storage` est également créé, mais il n'est pas
   monté — c'est la PVC en mode bloc qui assure ici le stockage durable, et non gcsfuse. Il n'y a aucun
   job d'initialisation de base de données à attendre — PhotoPrism crée son propre schéma SQLite au premier
   démarrage. Les premiers déploiements se terminent généralement en **10 à 20 minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep photoprism | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Par défaut, le Service est de type `LoadBalancer` (`service_type = "LoadBalancer"`) ; si
   `EXTERNAL_IP` est vide, vérifiez si un domaine personnalisé / une route Gateway a été
   configuré à la place (`enable_custom_domain = true` par défaut) et utilisez
   `kubectl get gateway,httproute -n "$NS"`.

2. Vérifiez que le service est sain. PhotoPrism expose un point de terminaison d'état non authentifié
   qui répond dès que le serveur HTTP est démarré et que l'index SQLite est prêt :

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/v1/status"   # expect a 200 JSON response
   ```

3. Récupérez le mot de passe administrateur généré automatiquement avant de vous connecter — aucun identifiant
   prédéfini n'est affiché ailleurs :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~photoprism-admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}` (ou votre domaine personnalisé) dans un navigateur et connectez-vous avec
   le nom d'utilisateur `admin` (ou la valeur configurée de `admin_username`) et le mot de passe récupéré
   ci-dessus. Une fois l'URL externe connue, envisagez d'y définir `site_url` dans la
   plateforme RAD et de l'appliquer via **Update** — cela corrige les liens absolus et les
   URL des miniatures qui, sinon, se rabattent sur l'hôte de la requête.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, le pod et la PVC en mode bloc (il n'y a pas de HPA à
   inspecter ; PhotoPrism est fixé à un seul réplica) :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count` et `max_instance_count`
   sont tous deux fixés à `1` par conception — PhotoPrism sert une bibliothèque SQLite partagée depuis
   une unique PVC en mode bloc accessible en écriture, et un second processus d'écriture concurrent risque de corrompre
   la base de données et l'index. Ce n'est pas un réglage de mise à l'échelle à ajuster.

3. **Ajustez les ressources à la taille de votre bibliothèque.** `cpu_limit`/`memory_limit` valent par défaut
   `1000m`/`2Gi` — 2Gi est le minimum qui permet de conserver la reconnaissance faciale et la prise en charge RAW ;
   PhotoPrism charge des index vectoriels en mémoire, et l'éditeur recommande `4Gi`
   pour de véritables charges d'indexation sur de grandes bibliothèques. Si vous voyez des redémarrages de pod dus à un OOM dans
   les événements de `kubectl describe pod` (tâche 4) à mesure que votre bibliothèque grandit, augmentez `memory_limit`
   dans la plateforme RAD et appliquez via **Update**. Vérifiez aussi que `stateful_fs_group = 3000`
   reste défini — un `fsGroup` incohérent ou absent rend la PVC non accessible en écriture pour
   l'UID 1000/GID 2000 de PhotoPrism et bloque le démarrage.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite (épinglée à un
   tag de build `PHOTOPRISM_VERSION`, et non au paramètre de version générique, lorsqu'il est laissé à
   `latest`) et le pod du StatefulSet est remplacé.

5. **Gérez les secrets et la PVC :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~photoprism"
   gcloud compute disks list --project="$PROJECT" --filter="name~$NS"
   ```

6. **Sauvegardez la médiathèque.** Comme PhotoPrism n'a pas de base de données SQL, une sauvegarde est
   une archive du système de fichiers contenant le contenu de la PVC (`backup_format = tar` par défaut), et non un
   dump de base de données. Passez en revue `backup_schedule` et `backup_retention_days` dans la plateforme
   RAD, et augmentez la rétention pour les bibliothèques de production.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods ainsi que le nombre de redémarrages — surveillez de près la mémoire à mesure que votre bibliothèque
   grandit, car l'indexation et la génération de miniatures sont gourmandes en mémoire, et surveillez aussi l'utilisation
   du disque de la PVC par rapport à sa taille par défaut de `20Gi`. Le module peut provisionner un
   **test de disponibilité** (uptime check, désactivé par défaut) ; activez-le via `uptime_check_config` et
   vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de PhotoPrism.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage
  et de liveness ciblent toutes deux `/api/v1/status` (aucune authentification requise) ; un problème de montage de la PVC ou
  une incohérence de `fsGroup` empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod bloqué en Pending avec `Quota 'SSD_TOTAL_GB' exceeded` :** la StorageClass par défaut
  `standard-rwo` puise dans le quota SSD régional restreint ; basculez vers du HDD
  avec `-var stateful_pvc_storage_class=standard` dans les projets aux quotas limités.
  Réduire le pod à zéro ne libère pas la PVC — seule sa suppression récupère le quota.
- **Conteneur arrêté pour OOM :** vérifiez le nombre de redémarrages du pod et ses événements ; si la mémoire plafonne
  près de la limite `memory_limit`, augmentez-la (voir la tâche 3) — 2Gi est la valeur par défaut du module,
  mais elle est sous-dimensionnée pour de vraies bibliothèques.
- **Compte administrateur inaccessible :** relisez le mot de passe dans Secret Manager
  (tâche 2) ; c'est la source de vérité et PhotoPrism le réapplique à chaque démarrage.
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes
  de ressources ou de quotas, et vérifiez que le Service/Gateway dispose d'une IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment pourquoi `max_instance_count` ne doit jamais dépasser 1, et pourquoi
désactiver `stateful_pvc_enabled` provoque un repli sur gcsfuse, qui ne peut pas héberger
SQLite en toute sécurité).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le StatefulSet Kubernetes
et l'espace de noms, le Persistent Disk en mode bloc (y compris la base de données SQLite intégrée et
tous les originaux qu'il contient), le bucket GCS `storage` inutilisé et les secrets
Secret Manager. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, Artifact
Registry) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet à réplica unique avec une PVC en mode bloc de 20Gi et le secret du mot de passe administrateur — aucune initialisation de base de données à attendre |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle d'état réussit ; récupérer le mot de passe administrateur généré automatiquement et se connecter |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/la PVC (ne jamais dépasser 1 réplica), ajuster les ressources à la taille de la bibliothèque, mettre à jour la version, gérer les secrets et les sauvegardes |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring, en particulier la mémoire et l'utilisation de la PVC, et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de quota SSD, d'OOM, d'identifiants administrateur, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris la PVC en mode bloc et ses données |
