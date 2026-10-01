---
title: "Changedetection.io sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Changedetection.io sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Changedetection_GKE.md @ 3055034 sha256:3642cbe6eb63 -->

# Changedetection.io sur GKE Autopilot — Guide de lab {#changedetectionio-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Changedetection_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

changedetection.io est un service auto-hébergé qui surveille les modifications de pages web et
envoie des notifications lorsqu'elles se produisent. Ce lab vous fait parcourir tout le cycle de vie
opérationnel du module **changedetection.io on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités de changedetection.io. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Changedetection_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Définir un mot de passe initial pour le tableau de bord (ou placer la charge de travail derrière IAP), puisque
  changedetection.io est livré sans connexion.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet et son PVC, respecter la
  contrainte de mise à l'échelle à un seul réplica, mettre à jour la version et gérer les secrets/le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
  changedetection.io n'a besoin d'aucune base de données, donc aucune instance Cloud SQL n'est requise pour ce
  module en particulier.
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Changedetection (GKE)**
   dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Changedetection_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous forme de **StatefulSet**
   avec un Persistent Disk en mode bloc de 20Gi monté sur `/datastore` (la valeur par défaut lorsque
   `stateful_pvc_enabled = true`), provisionne un bucket de données GCS (utilisé pour le repli GCS FUSE
   et les sauvegardes), construit l'image de conteneur (en épinglant `application_version =
   "latest"` sur un tag éprouvé via l'argument de build `CHANGEDETECTION_VERSION`) et
   l'expose via un Ingress Kubernetes doté d'une IP statique réservée et d'un certificat géré par
   Google. Il n'y a ni base de données ni job d'initialisation, si bien que les premiers déploiements prennent
   environ **15 à 30 minutes** — plus rapidement que la plupart des modules GKE, l'essentiel du temps étant consacré au build
   de l'image et à la planification des nœuds Autopilot plutôt qu'au provisionnement de Cloud SQL.

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep changedetection | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod du StatefulSet est en cours d'exécution et trouvez l'adresse externe de l'Ingress
   (le Service est de type `ClusterIP` par défaut ; c'est l'Ingress qui porte l'IP statique réservée) :

   ```bash
   kubectl get pods,statefulset,pvc -n "$NS"
   kubectl get ingress -n "$NS"
   EXTERNAL_IP=$(kubectl get ingress -n "$NS" \
     -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Lorsqu'aucun domaine personnalisé n'est configuré, le module sert un nom d'hôte `nip.io` dérivé
   de cette IP (par exemple `https://<ip>.nip.io`), si bien que HTTPS fonctionne sans posséder de domaine.
   Le certificat géré par Google peut mettre jusqu'à une heure pour terminer son provisionnement sur un
   nouveau déploiement — un Ingress qui renvoie 404 ou expire juste après l'application attend souvent
   encore le certificat ; il ne s'agit pas d'un déploiement défaillant.

2. Vérifiez que le tableau de bord répond :

   ```bash
   curl -sk -o /dev/null -w "%{http_code}\n" "https://${EXTERNAL_IP}.nip.io/"
   # expect 200 — the changedetection.io dashboard (startup/liveness probes target the same path)
   ```

3. Ouvrez l'URL dans un navigateur. changedetection.io est livré **sans connexion par défaut** —
   le tableau de bord est immédiatement accessible à quiconque atteint l'Ingress. Accédez à
   **Settings → General → Password** et définissez immédiatement un mot de passe, et/ou activez IAP
   (groupe 20 — `enable_iap`) afin que la connexion Google contrôle l'accès avant le chargement du tableau de bord.
   Il n'existe aucun identifiant administrateur pré-provisionné à consulter dans Secret Manager.

4. Définissez `BASE_URL` maintenant que l'adresse externe est connue, afin que le corps des notifications
   contienne des liens fonctionnels (le wrapper GKE ne l'injecte pas automatiquement) :

   ```bash
   kubectl set env -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     BASE_URL="https://${EXTERNAL_IP}.nip.io"
   ```

   Vous pouvez aussi définir `environment_variables = { BASE_URL = "https://..." }` dans la configuration du module
   et l'appliquer via **Update** afin que la valeur survive au prochain déploiement.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, le pod, le PVC et le pod disruption budget :

   ```bash
   kubectl get statefulset,pods,pvc,pdb -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl describe pvc -n "$NS"
   ```

2. **Ne dépassez pas un seul réplica.** `min_instance_count` et `max_instance_count`
   valent tous deux `1` par défaut et doivent le rester — le planificateur de récupération s'exécute dans le processus
   sur un unique datastore à base de fichiers, et un second réplica écrivant sur le même volume
   `/datastore` risque de corrompre `url-watches.json`. Il n'y a aucun HPA à gérer
   ici ; la seule « mise à l'échelle » prise en charge est verticale (`cpu_limit`/`memory_limit`),
   via **Update** sur la page de détails du déploiement.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite (en épinglant de nouveau `latest` sur le
   tag éprouvé actuel s'il est laissé à `latest`) et le StatefulSet redéploie l'unique pod.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~changedetection"
   gcloud storage buckets list --project="$PROJECT" --filter="name~changedetection"
   kubectl get cronjob -n "$NS"     # backup_schedule, if any backup jobs are configured
   ```

   changedetection.io n'a aucun secret applicatif propre — le jeton facultatif de l'API REST
   est généré dans l'interface web (**Settings → API**), et non injecté via une variable d'environnement
   ou Secret Manager. Il n'y a pas non plus de base de données à laquelle se connecter ; tout l'état (surveillances,
   instantanés, historique des différences, mot de passe de l'interface) réside sur le volume `/datastore` — ne
   supprimez ni ne recréez jamais le PVC (ou le bucket GCS, si vous fonctionnez avec `stateful_pvc_enabled
   = false`) sans sauvegarde, car cela efface définitivement tout l'historique de surveillance.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et mémoire
   des pods, le nombre de redémarrages et l'utilisation des PVC. Le module peut provisionner un **test
   de disponibilité** (lorsque `uptime_check_config` est défini) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de changedetection.io.

- **Pod non Ready / CrashLoopBackOff :** les sondes de démarrage et de vivacité ciblent `/` —
  l'interface web. Le premier démarrage est rapide (pas de migrations, pas de base de données à attendre), donc un pod
  bloqué en Pending ou qui redémarre sans cesse relève plus souvent d'un problème de planification, de liaison du PVC ou
  de récupération d'image que d'un retard de démarrage de l'application.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC bloqué en Pending / pod bloqué en Pending :** comparez la `StorageClass` du PVC
  (`standard-rwo` par défaut) au quota SSD régional — les PVC en mode bloc de GKE consomment le
  quota `SSD_TOTAL_GB`, qui peut être serré sur les projets contraints par les quotas.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
- **L'Ingress n'a pas d'IP externe, ou HTTPS ne fonctionne pas encore :** vérifiez que l'IP statique a été
  réservée et que le certificat géré a terminé son provisionnement — cela peut prendre jusqu'à
  une heure après le premier déploiement ; c'est un état normal et transitoire, et non un échec.
  ```bash
  kubectl describe ingress -n "$NS"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Les données de surveillance ne persistent pas entre les redémarrages de pods :** vérifiez que le PVC est bien lié
  et monté sur `/datastore` (ou, avec le repli GCS FUSE, que le bucket existe et
  est monté) — un chemin de montage incorrect bascule silencieusement sur le disque éphémère du pod.
- **Les liens des notifications sont cassés (pointent vers `localhost` ou vers rien) :** `BASE_URL` n'est
  pas injecté automatiquement sur GKE ; définissez-le comme indiqué à l'étape 4 de la tâche 2.
- **Tableau de bord accessible à tous :** il n'y a pas de connexion par défaut — définissez un mot de passe
  sous **Settings → General** ou activez IAP (groupe 20) ; il s'agit d'un comportement attendu,
  et non d'un bogue, tant que vous n'avez configuré ni l'un ni l'autre.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle : conserver `max_instance_count = 1` et ne jamais supprimer
le PVC/bucket du datastore).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms (StatefulSet, PVC et Ingress), les secrets Secret Manager, les buckets GCS et
les images d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie le StatefulSet GKE + PVC en mode bloc, le bucket de données GCS, l'Ingress avec IP statique/certificat géré, et construit l'image — aucune base de données, aucun job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle d'état réussit ; définir un mot de passe pour le tableau de bord (ou IAP) et `BASE_URL` |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, conserver un seul réplica, mettre à jour la version, gérer les secrets/le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, d'Ingress/certificat et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
