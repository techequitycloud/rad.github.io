---
title: "Calibre-Web sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Calibre-Web sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/CalibreWeb_GKE.md @ 3055034 sha256:408f3bc6a5bb -->

# Calibre-Web sur GKE Autopilot — Guide de lab {#calibre-web-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalibreWeb_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Calibre-Web est une application web auto-hébergée qui permet de parcourir, lire et télécharger des livres numériques
d'une bibliothèque Calibre — elle fournit une liseuse dans le navigateur, un flux OPDS et la synchronisation Kobo
au-dessus de l'image amont LinuxServer.io. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **Calibre-Web on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de Calibre-Web. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/CalibreWeb_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet et le PVC, et gérer l'identifiant administrateur.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Calibre-Web (GKE)**
   dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/CalibreWeb_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. L'interface web est accessible de l'extérieur
   dès l'installation — `service_type` vaut déjà `LoadBalancer` par défaut (voir la tâche 2).
   Ne renseignez `application_domains` que si vous souhaitez un nom d'hôte personnalisé servi par la
   Gateway plutôt que l'adresse IP brute du LoadBalancer. Cliquez sur **Deploy
   Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la
   page d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit et met en miroir l'image de conteneur (épinglée sur un tag
   `0.6.24` éprouvé lorsque `application_version = "latest"`), déploie un **StatefulSet**
   dans le cluster GKE Autopilot (sélectionné automatiquement parce que `stateful_pvc_enabled =
   true`), provisionne un Persistent Volume Claim en mode bloc par pod, monté sur `/config`,
   ainsi qu'un secret Secret Manager (`CALIBRE_ADMIN_PASSWORD`). Il n'y a ni base de données
   ni job d'initialisation — Calibre-Web gère son propre stockage SQLite au premier
   démarrage. Les premiers déploiements prennent généralement **5 à 15 minutes** (essentiellement le build
   du conteneur et le provisionnement du PVC).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep calibreweb | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution :

   ```bash
   kubectl get statefulset,pods -n "$NS"
   ```

2. Déterminez comment y accéder. `service_type` vaut **`LoadBalancer`** par défaut, donc une
   adresse IP externe est provisionnée dès l'installation. `enable_custom_domain = true` provisionne également
   une ressource Gateway API, mais la valeur par défaut vide `application_domains = []`
   ne lui laisse aucun nom d'hôte à router — **l'adresse IP du LoadBalancer est donc le point d'entrée**,
   sauf si vous avez renseigné `application_domains` ou basculé `service_type` sur
   `LoadBalancer` avant le déploiement :

   ```bash
   kubectl get svc,gateway,httproute -n "$NS"
   # If service_type = LoadBalancer:
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   # If ClusterIP only, port-forward for this lab:
   kubectl port-forward -n "$NS" svc/<service-name> 8083:8083
   ```

3. Vérifiez que le service est sain. Les sondes de démarrage et de vivacité de Calibre-Web
   ciblent toutes deux le chemin racine, qui sert la page de connexion sans authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP:-localhost}:8083/"   # expect 200
   ```

4. Ouvrez l'adresse dans un navigateur. Connectez-vous avec les identifiants par défaut intégrés
   à l'image amont — **`admin` / `admin123`** — le secret
   `CALIBRE_ADMIN_PASSWORD` généré automatiquement dans Secret Manager n'est **pas** relié au
   processus de connexion du conteneur. Juste après la première connexion, changez le mot de passe
   administrateur dans l'interface de Calibre-Web (Admin → Edit User) ; vous pouvez utiliser
   la valeur du secret généré comme nouveau mot de passe :

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

5. Faites pointer Calibre-Web vers votre bibliothèque de livres numériques : utilisez l'assistant de configuration intégré pour définir
   l'emplacement de la bibliothèque sur `/books` (vide au premier lancement — téléversez-y ou synchronisez-y des livres
   ensuite).

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail, son PVC et le PodDisruptionBudget :**

   ```bash
   kubectl get statefulset,pods,pvc,pdb -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **N'augmentez pas `max_instance_count` au-delà de `1`.** Les
   `volumeClaimTemplates` du StatefulSet donnent à chaque réplica son propre PVC indépendant — la mise à l'échelle
   ne partage **pas** `/config` entre les pods ; elle scinde silencieusement la bibliothèque et
   la configuration en copies distinctes et non synchronisées par pod. La mise à l'échelle est une modification
   de configuration dans la plateforme RAD (modifiez les paramètres d'instances min/max et cliquez sur
   **Update**), et non un `kubectl scale` manuel — une modification manuelle serait annulée lors
   de la prochaine application.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite (épinglée via l'ARG de build
   propre à l'application `CALIBREWEB_VERSION`) et une mise à jour progressive remplace le
   pod.

4. **Inspectez le PVC `/config` et son disque sous-jacent :**

   ```bash
   kubectl describe pvc -n "$NS" -l app=<service-name>
   gcloud compute disks list --project="$PROJECT" --filter="name~calibreweb"
   ```

   La StorageClass par défaut (`standard-rwo`) repose sur des SSD et consomme le quota régional
   restreint `SSD_TOTAL_GB` ; envisagez `stateful_pvc_storage_class = "standard"`
   (HDD) si vous exécutez une série d'applications GKE avec état dans le même projet.
   Réduire la charge de travail à zéro ne libère **pas** le PVC — seule sa suppression
   (ou celle de l'espace de noms) le fait.

5. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~calibreweb"
   kubectl get jobs -n "$NS"   # only user-supplied jobs, if any
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et l'utilisation des PVC. Les tests de disponibilité sont
   **désactivés par défaut** (`uptime_check_config.enabled = false`) — activez-en un dans
   la plateforme RAD si vous souhaitez des alertes de disponibilité automatisées (nécessite qu'un accès
   externe soit configuré, conformément à la tâche 2).

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Calibre-Web.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de démarrage
  cible `/` (la page de connexion, `200`, sans authentification requise) avec un
  `failure_threshold=10` généreux à `period=10s`, si bien qu'un conteneur lent à démarrer a encore
  le temps de la réussir.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **La connexion échoue avec les identifiants intégrés :** vérifiez que vous utilisez
  `admin` / `admin123` (la valeur par défaut amont), et non la valeur Secret Manager
  `CALIBRE_ADMIN_PASSWORD` — ce secret est provisionné mais n'est pas appliqué au
  processus de connexion réel du conteneur.
- **Aucun accès externe :** `service_type` vaut `LoadBalancer` par défaut, donc
  vérifiez si une adresse IP externe a déjà été attribuée (cela peut prendre une ou deux minutes).
  Un `application_domains` vide signifie seulement que le chemin du domaine personnalisé n'a aucun nom d'hôte à
  router — l'adresse IP du LoadBalancer reste le point d'entrée (voir la tâche 2).
- **PVC bloqué en `Pending` / quota `SSD_TOTAL_GB` dépassé :** vérifiez l'utilisation actuelle des disques
  et envisagez de passer `stateful_pvc_storage_class` à `standard` (HDD) sur un
  projet contraint par les quotas ; rappelez-vous que la réduction à zéro ne libère pas les PVC existants.
  ```bash
  kubectl describe pvc -n "$NS"
  gcloud compute disks list --project="$PROJECT"
  ```
- **Scission des données suspectée après une mise à l'échelle :** si `max_instance_count` a déjà été porté
  au-delà de `1`, chaque pod détient un `/config` indépendant et non synchronisé — vérifiez
  `kubectl get pvc -n "$NS"` pour repérer plusieurs PVC et réconciliez en choisissant les données d'un pod
  comme référence avant de revenir à `1`.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre. Notez deux écarts confirmés entre la documentation et le code source à garder à l'esprit
pendant le dépannage : le texte de description de la variable `liveness_probe` (hérité
de la fondation partagée) mentionne un endpoint `/health` que Calibre-Web n'expose
pas (le chemin réellement configuré est `/` — ne le remplacez pas par `/health`), et la
description de la sortie `calibreweb_url` du module frère Cloud Run contient une
référence obsolète, issue d'un copier-coller sans rapport, à une « REST API (port 6333) » — sans objet
pour la sortie `service_url` de la variante GKE, qui est simplement l'adresse normale permettant
d'atteindre la charge de travail selon `service_type`.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et l'espace de noms, le PVC par pod (ainsi que son disque sous-jacent, avec votre bibliothèque
de livres numériques et les bases SQLite de Calibre-Web, puisqu'elles ne résident que sur ce volume),
le secret `CALIBRE_ADMIN_PASSWORD` et les images d'Artifact Registry. Les ressources appartenant
à **Services_GCP** (le VPC, le cluster GKE, le registre) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet avec un PVC en mode bloc par pod sur `/config` et un secret Secret Manager pour le mot de passe administrateur ; aucune base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; vérifier/configurer l'accès externe ; se connecter avec `admin`/`admin123` et changer immédiatement le mot de passe |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, conserver `max_instance_count=1`, mettre à jour la version, surveiller le quota SSD |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring (test de disponibilité facultatif, désactivé par défaut) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de connexion, d'entrée, de PVC/quota et de récupération d'image ; deux écarts connus doc/source signalés |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le PVC et son disque avec la bibliothèque de livres numériques et l'état SQLite |
