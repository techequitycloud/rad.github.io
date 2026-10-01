---
title: "Meilisearch sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Meilisearch sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Meilisearch_GKE.md @ 3055034 sha256:f6798bbe6747 -->

# Meilisearch sur GKE Autopilot — Guide de lab {#meilisearch-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30 à 60 minutes

Meilisearch est un moteur de recherche open source et rapide — un unique binaire Rust qui
offre une recherche instantanée, tolérante aux fautes de frappe et à facettes derrière une API REST simple, largement
utilisé comme alternative auto-hébergeable à Algolia. Ce lab vous fait parcourir tout le
cycle de vie opérationnel du module **Meilisearch on GKE Autopilot** sur Google
Cloud : le déployer avec un PVC de StatefulSet, y accéder et le vérifier, construire un véritable index
de recherche et l'interroger, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur chaque fonctionnalité de Meilisearch. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module (PVC de StatefulSet) depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution, la vérifier et récupérer la clé maîtresse.
- Créer un index, ajouter des documents et lancer une recherche tolérante aux fautes de frappe via l'API REST.
- Effectuer les opérations du jour 2 — inspecter les pods et le PVC, mettre à jour, créer des clés à portée limitée et gérer les sauvegardes.
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
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- **kubectl** installé.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Meilisearch (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et définissez
   `stateful_pvc_enabled = true` pour un stockage Persistent Disk de niveau production. **Définissez
   également `stateful_pvc_mount_path = "/meili_data"`** — la valeur par défaut de cette
   variable (`/meilisearch/storage`) ne correspond **pas** au `MEILI_DB_PATH` fixe
   (`/meili_data`) ; la laisser à sa valeur par défaut signifie donc que le PVC ne reçoit jamais les
   données d'index (il apparaît vide à chaque redémarrage). Passez en revue les autres paramètres — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme génère la `MEILI_MASTER_KEY` et la stocke dans Secret Manager
   (en l'injectant sous forme de Secret Kubernetes natif), construit et réplique
   l'image `getmeili/meilisearch:v1.11`, crée un StatefulSet avec un PVC monté sur
   le chemin défini dans `stateful_pvc_mount_path` (`/meili_data`, selon l'étape 1 ci-dessus),
   et expose par défaut un Service **LoadBalancer** (`service_type =
   "LoadBalancer"`). Il n'y a **aucune** base de données Cloud SQL et **aucun** job d'initialisation —
   Meilisearch gère son propre stockage. Les premiers déploiements prennent environ **8 à 15 minutes**
   (build de l'image + planification des pods Autopilot).

3. Une fois l'opération terminée, récupérez les identifiants du cluster et identifiez les ressources avec
   des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep -i meilisearch | head -1 | cut -d/ -f2)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -iv headless | head -1 | cut -d/ -f2)
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   MEILI_MASTER_KEY=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Namespace: $NAMESPACE"
   echo "Service:   $SERVICE"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est en cours d'exécution et que le PVC est lié :

   ```bash
   kubectl get pods,pvc -n "$NAMESPACE"
   ```

2. Effectuez une redirection de port vers le Service et interrogez le point de terminaison non authentifié `/health`, qui
   renvoie `{"status":"available"}` une fois le moteur prêt :

   ```bash
   kubectl port-forward -n "$NAMESPACE" "svc/$SERVICE" 7700:7700 &
   curl -s "http://localhost:7700/health"          # expect {"status":"available"}
   ```

3. Vérifiez que la clé maîtresse fonctionne et liste l'ensemble (initialement vide) des index :

   ```bash
   curl -s "http://localhost:7700/indexes" -H "Authorization: Bearer $MEILI_MASTER_KEY"
   # expect {"results":[],"offset":0,"limit":20,"total":0}
   ```

---

## Tâche 3 — Construire un index et l'interroger (exemple commenté) [Manuel] {#task-3--build-an-index-and-search-it-worked-example-manual}

Avec la redirection de port de la tâche 2 toujours ouverte, créez un index, ajoutez des documents et lancez
une recherche tolérante aux fautes de frappe — le tout via l'API REST, avec la clé maîtresse comme jeton
Bearer.

1. **Ajoutez des documents.** Meilisearch crée l'index automatiquement lors de la première écriture ;
   le champ `id` est la clé primaire :

   ```bash
   curl -s -X POST "http://localhost:7700/indexes/movies/documents" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '[
       {"id":1,"title":"Interstellar","genre":"Sci-Fi","year":2014},
       {"id":2,"title":"Inception","genre":"Sci-Fi","year":2010},
       {"id":3,"title":"The Grand Budapest Hotel","genre":"Comedy","year":2014}
     ]'
   # returns a task: {"taskUid":0,"status":"enqueued",...}
   ```

2. **Attendez la fin de l'indexation** (les écritures sont traitées de manière asynchrone sous forme de tâches) :

   ```bash
   curl -s "http://localhost:7700/indexes/movies/tasks" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" | head
   # look for "status":"succeeded"
   ```

3. **Recherchez — avec une faute de frappe volontaire** pour démontrer la tolérance intégrée aux fautes de frappe
   (`interstellr` trouve quand même *Interstellar*) :

   ```bash
   curl -s "http://localhost:7700/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"interstellr"}'
   # returns the Interstellar hit in a few milliseconds
   ```

4. **Filtrez et utilisez les facettes.** Rendez `genre` et `year` filtrables, puis interrogez-les :

   ```bash
   curl -s -X PATCH "http://localhost:7700/indexes/movies/settings/filterable-attributes" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '["genre","year"]'

   curl -s "http://localhost:7700/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"","filter":"year = 2014 AND genre = Sci-Fi"}'
   # returns only Interstellar
   ```

5. **Vérification de la persistance.** Tout cela réside sur le PVC dans `/meili_data` — ce n'est vrai
   que si `stateful_pvc_mount_path` a été défini sur `/meili_data` à la tâche 1 (la
   valeur par défaut `/meilisearch/storage` ne sert pas de support au répertoire de données, si bien que l'index
   serait perdu lors de la recréation du pod). Supprimez le pod et observez le StatefulSet
   le recréer avec les mêmes données attachées :

   ```bash
   kubectl delete pod -n "$NAMESPACE" -l app=meilisearch      # StatefulSet recreates it
   kubectl get pods -n "$NAMESPACE" -w                         # wait for Running/Ready
   # re-run the search from step 3 — the index is still there
   ```

---

## Tâche 4 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-4--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail, le PVC et les événements :**

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NAMESPACE"
   kubectl describe pvc -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" "statefulset/$SERVICE" --tail=100
   ```

2. **Ne mettez pas à l'échelle horizontalement.** Meilisearch n'accepte qu'un seul écrivain ; le module fixe
   `max_instance_count = 1`. Pour absorber davantage de charge, augmentez `cpu_limit`/`memory_limit`
   via **Update**, et non le nombre de réplicas — le module possède la spécification de la charge de travail, donc un
   `kubectl scale` manuel serait annulé lors de la prochaine application.

3. **Créez une clé API à portée limitée, réservée à la recherche,** pour votre application au lieu de partager la
   clé maîtresse :

   ```bash
   curl -s -X POST "http://localhost:7700/keys" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"description":"web search-only","actions":["search"],"indexes":["movies"],"expiresAt":null}'
   # returns a scoped "key" — distribute THIS, never the master key
   ```

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et le StatefulSet remplace progressivement le
   pod.

5. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~meilisearch"
   kubectl get cronjob -n "$NAMESPACE"          # scheduled backup jobs, if enabled
   ```

---

## Tâche 5 — Observer : journalisation et surveillance [Manuel] {#task-5--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Surveillance** — ouvrez le tableau de bord de la charge de travail GKE et examinez l'utilisation CPU / mémoire
   des pods (surveillez la mémoire à mesure que votre index grossit), le nombre de redémarrages et l'utilisation du PVC. Si
   vous avez activé le **test de disponibilité** sur `/health`, vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 6 — Dépanner et déboguer [Manuel] {#task-6--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Meilisearch.

- **Pod en CrashLoopBackOff / ne démarre pas :** une cause fréquente est une **clé maîtresse manquante** —
  en mode production, Meilisearch s'arrête immédiatement si `MEILI_MASTER_KEY` n'est pas définie ou
  fait moins de 16 octets. Vérifiez que `enable_api_key = true` et que le Secret K8s est
  présent :
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=meilisearch
  kubectl get secret -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" "statefulset/$SERVICE" --previous --tail=100
  ```
- **`401`/`403` sur les appels API :** la clé que vous avez envoyée ne correspond pas à la
  `MEILI_MASTER_KEY` déployée. Relisez-la depuis Secret Manager et réessayez.
- **Pod en attente (Pending) :** Autopilot est en train de planifier de la capacité ou le PVC n'est pas lié — consultez
  `kubectl describe pod` et `kubectl get pvc`.
- **L'index semble vide après un redémarrage du pod :** vérifiez que le chemin de montage du PVC est
  `/meili_data` (il doit correspondre à `MEILI_DB_PATH`) et que le PVC a bien été rattaché.
- **`Image not found` / échec du build :** consultez l'historique de Cloud Build pour le journal du
  build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez que le compte de service Google de la charge de travail (Workload
  Identity) dispose des rôles d'accès à Secret Manager et au stockage.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment maintenir le chemin du PVC aligné sur `MEILI_DB_PATH` et ne jamais exécuter
plus d'un réplica sur le même volume).

---

## Tâche 7 — Démanteler [Automatisé] {#task-7--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le StatefulSet,
le Service Kubernetes, le PVC (et toutes les données indexées), le secret `MEILI_MASTER_KEY`
et les images d'Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un StatefulSet + PVC et le secret de la clé maîtresse, et construit l'image (pas de base de données) |
| 2 — Accéder et vérifier | Manuel | Pod Running, PVC lié ; `/health` renvoie available ; la clé maîtresse liste les index |
| 3 — Indexer et rechercher | Manuel | Créer un index, ajouter des documents, lancer une recherche tolérante aux fautes de frappe + filtrée ; résiste à la suppression d'un pod |
| 4 — Exploiter | Manuel | Inspecter les pods et le PVC, dimensionner verticalement, créer des clés à portée limitée, mettre à jour la version, gérer les sauvegardes |
| 5 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 6 — Dépanner | Manuel | Diagnostiquer les problèmes de clé maîtresse, d'authentification, de planification, de PVC, de build et d'IAM |
| 7 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le PVC et les données indexées |
