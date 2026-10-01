---
title: "Homepage sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Homepage sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Homepage_GKE.md @ 3055034 sha256:22fcf726b6b5 -->

# Homepage sur GKE Autopilot — Guide de lab {#homepage-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Homepage_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–45 minutes

Homepage est un tableau de bord d'applications auto-hébergé et hautement personnalisable — une
page d'accueil unique regroupant liens, favoris et widgets d'état/statistiques en direct pour
vos autres services auto-hébergés, entièrement configurée au moyen de fichiers YAML.
Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Homepage
on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités d'édition de tableau de bord propres à Homepage. Pour la
liste complète des services provisionnés et de chaque paramètre de configuration
(organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Homepage_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Comprendre les deux dispositions de stockage que GKE propose à Homepage (GCS FUSE ou un PVC en mode bloc) et laquelle est déployée.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour.
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
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into

CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

export NAMESPACE=$(kubectl get ns -o name | grep homepage | head -1 | cut -d/ -f2)
echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Homepage (GKE)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. La plupart des déploiements ne nécessitent aucune modification des valeurs par défaut — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Homepage_GKE)
   documente chaque paramètre par groupe. Si le quota d'adresses IP externes de votre projet est
   limité, définissez `service_type = "ClusterIP"` et `reserve_static_ip =
   false` (c'est ce qu'a utilisé la vérification en conditions réelles de ce module). Cliquez sur
   **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui
   ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot et
   provisionne son stockage. Par défaut, il s'agit d'un **Deployment** sans état
   avec un bucket GCS `storage` monté sur `/app/config` via le pilote CSI GCS FUSE.
   Si `stateful_pvc_enabled = true` est défini, la charge de travail est plutôt
   un **StatefulSet** avec un PVC en mode bloc par pod (`standard-rwo`, `5Gi`
   par défaut) au même chemin. **Il n'y a ni instance Cloud SQL, ni Redis,
   ni secret Secret Manager** — Homepage n'a besoin d'aucun d'eux. Les premiers
   déploiements se terminent généralement en **5–10 minutes**, plus vite que la plupart des modules
   de ce catalogue puisqu'il n'y a aucune base de données à provisionner.

3. Vérifiez la charge de travail et ses pods :

   ```bash
   kubectl get all -n "$NAMESPACE"
   # If stateful_pvc_enabled = true, also check the PVC:
   kubectl get pvc -n "$NAMESPACE"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et trouvez son adresse. Si
   `service_type = LoadBalancer` :

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   SERVICE_URL="http://${EXTERNAL_IP}"
   ```

   Si `service_type = ClusterIP` (par exemple dans un projet au quota limité),
   utilisez plutôt `kubectl port-forward` — aucune adresse IP externe n'est consommée :

   ```bash
   SVC=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NAMESPACE" "svc/$SVC" 18080:3000 &
   SERVICE_URL="http://localhost:18080"
   ```

2. Vérifiez que le service est en bonne santé — via le point de terminaison de santé propre à Homepage,
   accessible sans authentification :

   ```bash
   curl -s "$SERVICE_URL/api/healthcheck" -o /dev/null -w '%{http_code} %{size_download}\n'
   # expect: 200 <n-bytes>
   curl -s "$SERVICE_URL/api/healthcheck"
   # expect: "up"
   ```

3. Ouvrez `$SERVICE_URL` dans un navigateur (ou interrogez-le directement avec `curl` si vous utilisez
   le port-forward). **Il n'y a ni assistant de configuration au premier lancement ni connexion** —
   Homepage affiche immédiatement son tableau de bord à partir de la configuration présente dans
   `/app/config` (les valeurs par défaut intégrées à l'image amont sur un déploiement
   neuf). Vous devriez voir la page d'accueil par défaut de Homepage.

4. Vérifiez quel mode de stockage est actif et où se trouve réellement la
   configuration :

   ```bash
   kubectl get statefulset -n "$NAMESPACE" 2>/dev/null && echo "block-PVC mode" \
     || echo "GCS FUSE mode (Deployment)"
   ```

   - **Mode GCS FUSE :**
     ```bash
     BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~homepage" \
       --format="value(name)" --limit=1)
     gcloud storage ls "gs://$BUCKET/"
     gcloud storage cat "gs://$BUCKET/settings.yaml"
     ```
   - **Mode PVC en mode bloc :**
     ```bash
     POD=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
     kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /app/config
     kubectl exec -n "$NAMESPACE" "$POD" -- cat /app/config/settings.yaml
     ```

5. Effectuez une modification réelle et persistante, puis vérifiez qu'elle est conservée — modifiez
   `services.yaml` directement (via le bucket ou `kubectl exec`, selon
   le mode de stockage actif), puis rechargez la page. Homepage lit
   sa configuration YAML en direct à chaque requête ; la nouvelle entrée apparaît donc
   immédiatement, sans redémarrage nécessaire — c'est la véritable preuve que le
   raccordement du stockage fonctionne de bout en bout.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail :**

   ```bash
   kubectl get deploy,statefulset,pods -n "$NAMESPACE" 2>/dev/null
   kubectl describe pod -n "$NAMESPACE" $(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances puis en cliquant sur
   **Update**. Dans le mode de stockage GCS FUSE par défaut, passer au-delà d'une
   réplique est réellement sans risque — chaque pod lit le même bucket partagé, sans
   cache en processus. **Si `stateful_pvc_enabled = true`, conservez
   `max_instance_count = 1`** — chaque ordinal de pod du StatefulSet reçoit son propre
   PVC distinct ; plusieurs répliques maintiendraient donc chacune une configuration divergeant
   indépendamment, plutôt qu'un tableau de bord partagé.

3. **Mettez à jour le tag de version de l'application** via le flux **Update** de la plateforme
   RAD. Comme l'image est réellement préconstruite
   (`ghcr.io/gethomepage/homepage`), aucune étape Cloud Build locale n'intervient —
   la plateforme fait simplement pointer le déploiement progressif suivant vers le nouveau tag.

4. **Vérifiez qu'il n'y a aucun secret à gérer :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~homepage"
   # expect: no results — this is correct, not a misconfiguration
   ```

5. **Inspectez ou sauvegardez la configuration :**

   ```bash
   # GCS FUSE mode:
   gcloud storage rsync "gs://$BUCKET/" /tmp/homepage-config-backup/
   # Block-PVC mode:
   kubectl cp "$NAMESPACE/$POD:/app/config" /tmp/homepage-config-backup/
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NAMESPACE" $(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}') --tail=100
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU
   et de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module
   peut provisionner un **test de disponibilité** (uptime check) (désactivé par défaut) ; s'il est activé,
   vérifiez qu'il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les
  sondes de démarrage et de vivacité ciblent toutes deux `/api/healthcheck`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous        # logs from the crashed container
  ```

- **Erreurs `EACCES`/d'autorisation lors de l'écriture dans `/app/config` (mode PVC en mode bloc
  uniquement).** L'étape chown du point d'entrée gère normalement cela au démarrage,
  sans configuration nécessaire. Si vous voyez encore une erreur d'autorisation, vérifiez
  `stateful_fs_group` (par défaut `3000`) et assurez-vous qu'il n'a pas été remplacé par
  une valeur incohérente avec l'utilisateur d'exécution du conteneur.

- **Les widgets ne chargent pas leurs données / les appels `/api/*` renvoient 400.** C'est presque toujours
  `HOMEPAGE_ALLOWED_HOSTS` qui rejette l'en-tête `Host` de la requête. La valeur par défaut
  est `*` (accepte n'importe quel hôte) ; cela ne devrait donc se produire que si elle a été restreinte
  et que le nom d'hôte déployé a changé depuis. Vérifiez la valeur injectée :
  ```bash
  kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].spec.template.spec.containers[0].env}' \
    | grep -o '"name":"HOMEPAGE_ALLOWED_HOSTS"[^}]*'
  ```

- **Les modifications de configuration n'apparaissent pas.** Vérifiez que vous avez modifié le fichier réellement
  monté sur `/app/config` — la bonne cible (bucket GCS ou `kubectl
  exec` dans le PVC du pod) dépend du mode de stockage actif (voir
  la tâche 2, étape 4) — et que l'onglet du navigateur a été rechargé. Homepage n'a aucun
  cache côté serveur à invalider ; un affichage obsolète vient donc presque toujours d'un onglet
  de navigateur obsolète ou d'une mauvaise cible de stockage, et non d'un problème de raccordement.

- **Au-delà de 1 réplique en mode PVC en mode bloc, des modifications de configuration sont « perdues » sur
  certaines requêtes.** C'est attendu, et non un bug — chaque ordinal de pod du StatefulSet
  possède son propre PVC indépendant. Définissez `max_instance_count = 1`, ou
  revenez au mode GCS FUSE par défaut si vous avez besoin de plusieurs répliques.

- **Pod en attente (Pending) / pas d'adresse IP externe :** consultez les événements de `kubectl describe pod` pour
  détecter des problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer a une
  adresse IP attribuée (ou passez à `ClusterIP` + `kubectl port-forward` si le quota
  d'adresses IP statiques de votre projet est épuisé).

- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et
  que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer, utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud.
Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et
l'espace de noms, le bucket GCS `storage` (ou le PVC en mode bloc, dans ce mode de stockage)
et chaque fichier de configuration YAML qu'il contient, ainsi que les éventuelles images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE et son stockage (bucket GCS FUSE par défaut, ou un PVC en mode bloc avec `stateful_pvc_enabled = true`) — sans base de données, sans Redis, sans secrets |
| 2 — Accès et vérification | Manuel | Se connecter au cluster ou utiliser le port-forward ; `/api/healthcheck` renvoie `200 "up"` ; le tableau de bord s'affiche sans assistant de configuration ; une modification directe de la configuration prouve le raccordement du stockage |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (sans risque au-delà d'une réplique uniquement en mode GCS FUSE), mettre à jour la version, sauvegarder la configuration |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer la santé des pods, `HOMEPAGE_ALLOWED_HOSTS`, la confusion sur la cible de stockage et les problèmes de mise à l'échelle avec PVC |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le stockage de la configuration |
