---
title: "PocketBase sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer PocketBase sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/PocketBase_GKE.md @ 3055034 sha256:ec777a1c0ce1 -->

# PocketBase sur GKE Autopilot — Guide de lab {#pocketbase-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/PocketBase_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

PocketBase est un backend open source tenant dans un seul fichier — une base de données SQLite intégrée avec une
API REST en temps réel, une authentification intégrée, un stockage de fichiers et un tableau de bord d'administration. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **PocketBase on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit PocketBase. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/PocketBase_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder au StatefulSet en cours d'exécution.
- Accéder à la charge de travail, la vérifier, et revendiquer le compte administrateur du premier lancement.
- Effectuer les opérations du jour 2 — inspecter, sauvegarder et mettre à jour le déploiement.
- Comprendre pourquoi ce module exécute un StatefulSet à réplica unique avec un PVC en mode bloc.
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

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **PocketBase (GKE)** depuis la
   liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/PocketBase_GKE) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Laissez `stateful_pvc_enabled = true` et
   `max_instance_count = 1` — la base de données SQLite intégrée a besoin du verrouillage de fichiers fiable
   du PVC en mode bloc, et un second réplica ne peut pas monter le volume ReadWriteOnce. Cliquez sur **Deploy
   Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un **StatefulSet** avec
   un Persistent Volume en mode bloc de 20 GiB monté sur `/pb_data`, et construit l'image de conteneur.
   Il n'y a **ni instance Cloud SQL ni job d'initialisation de base de données** — PocketBase crée
   son propre schéma SQLite au premier démarrage. Les premiers déploiements se terminent généralement en **10–20
   minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep pocketbase | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod s'exécute. Le Service est de type `LoadBalancer` par défaut (externe), puisque
   PocketBase est un backend-as-a-service exposé au public — trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. PocketBase expose un point de terminaison de santé public et non authentifié
   qui répond dès que le binaire est démarré — il n'y a aucune base de données externe à
   attendre :

   ```bash
   # From outside the cluster (only if a LoadBalancer/external IP is configured):
   curl -s "http://${EXTERNAL_IP}/api/health"
   # Or from inside the cluster, against the pod directly:
   kubectl exec -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- wget -qO- http://127.0.0.1:8090/api/health
   ```

3. Ouvrez l'interface d'administration sur `/_/` (via l'IP externe, ou `kubectl port-forward` si vous avez défini
   `service_type = ClusterIP`) **immédiatement** :

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8090:8090   # if internal-only
   ```

   La première personne qui atteint `/_/` est invitée à créer le compte administrateur (superuser) —
   aucun identifiant administrateur n'est prédéfini dans Secret Manager, et tant que le compte n'est pas revendiqué,
   quiconque peut atteindre `/_/` peut le revendiquer. Saisissez une adresse e-mail et un mot de passe et terminez l'assistant
   de configuration, puis connectez-vous et parcourez les collections par défaut pour confirmer que la base de données
   s'est correctement initialisée.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, son pod et le PVC lié :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count` et `max_instance_count` valent tous deux
   `1` par défaut, et la plateforme RAD l'impose délibérément — SQLite n'admet qu'un seul rédacteur
   et le PVC est en ReadWriteOnce ; un second réplica ne peut donc même pas monter le volume. Si vous avez besoin
   de plus de capacité, augmentez `cpu_limit` / `memory_limit` sur le pod unique plutôt que d'augmenter
   le nombre de réplicas.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD et
   en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace le pod.
   PocketBase applique automatiquement les migrations de schéma en attente au démarrage suivant ; sauvegardez donc
   le PVC (étape 4) avant de changer de version — une mise à niveau interrompue peut laisser la
   base de données au milieu d'une migration.

4. **Sauvegardez `/pb_data`** — le PVC en mode bloc constitue l'intégralité de la base de données et du stockage de fichiers :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- ls -la /pb_data
   kubectl cp "$NS/$POD:/pb_data/data.db" ./pb_data-backup.db
   ```

5. **Gérez vos propres secrets** (pertinent uniquement si vous avez ajouté des identifiants SMTP ou de sauvegarde
   externe — PocketBase n'en génère aucun automatiquement) :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~pocketbase"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire
   des pods, le nombre de redémarrages et l'utilisation du PVC. Le nombre de réplicas doit rester stable à 1. Le
   test de disponibilité (uptime check) est désactivé par défaut ; activez `uptime_check_config` si vous souhaitez des alertes sur
   la disponibilité, puis vérifiez-le sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de PocketBase.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et de vivacité
  ciblent `/api/health`, qui ne dépend d'aucune ressource externe ; un échec à ce niveau désigne donc presque
  toujours un problème au niveau du conteneur (image défectueuse, variable d'environnement manquante, port incorrect)
  plutôt qu'un problème de base de données.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod bloqué en `Pending` :** recherchez des problèmes de provisionnement/de quota du PVC — un nouveau PVC
  `standard-rwo` (SSD) de 20 GiB puise dans le quota régional `SSD_TOTAL_GB`, facile à
  épuiser sur un projet aux quotas restreints :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # look for "Quota ... exceeded" or FailedScheduling
  kubectl get pvc -n "$NS"
  ```
- **Les données semblent manquantes ou réinitialisées :** vérifiez que `stateful_pvc_enabled = true` et que le pod est
  lié au PVC attendu (les pods d'un StatefulSet se relient au même PVC selon leur ordinal d'un
  redémarrage à l'autre) — un type de charge de travail `Deployment` ou un PVC désactivé laisse SQLite sur le stockage
  éphémère du pod, perdu à chaque redémarrage.
- **Impossible d'atteindre `/_/`, ou quelqu'un d'autre a revendiqué le compte administrateur :** il n'existe aucun mécanisme
  de réinitialisation côté plateforme ; utilisez la CLI/l'API PocketBase sur le pod en cours d'exécution, ou
  restaurez une sauvegarde du PVC antérieure à la revendication si cela s'est produit sur un nouveau déploiement.
- **Pas d'IP externe :** `service_type = LoadBalancer` est la valeur par défaut ; une IP devrait donc être
  provisionnée automatiquement — vérifiez avec `kubectl get svc -n "$NS"` si un `EXTERNAL-IP` est en attente
  (le provisionnement peut prendre une minute) ; vérifiez que `service_type` n'a pas été remplacé par `ClusterIP`.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre
(notamment pourquoi `max_instance_count` ne doit jamais être augmenté et pourquoi `workload_type` doit être
laissé à `null` pour se résoudre automatiquement en `StatefulSet`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple
après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela
supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le StatefulSet
Kubernetes, l'espace de noms et le PVC en mode bloc (qui **constitue** l'intégralité de la base de données SQLite et
des fichiers envoyés — sauvegardez-le d'abord si vous devez le conserver). Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, l'Artifact Registry partagé) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet à réplica unique avec un PVC en mode bloc de 20Gi sur `/pb_data` ; ni Cloud SQL, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'état réussit ; revendiquer immédiatement le compte administrateur du premier lancement sur `/_/` |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet, maintenir le nombre de réplicas à 1, sauvegarder le PVC, mettre à jour la version |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité (facultatif) |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota, de revendication du compte administrateur, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime le StatefulSet, l'espace de noms et le PVC qui contient toutes les données |
