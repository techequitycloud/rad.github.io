---
title: "Chibisafe sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Chibisafe sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Chibisafe_GKE.md @ 3055034 sha256:dc3a6a1d3038 -->

# Chibisafe sur GKE Autopilot — Guide de lab {#chibisafe-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chibisafe_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Chibisafe est un outil auto-hébergé de téléversement de fichiers et d'images,
avec téléversement par glisser-déposer, albums et API publique. Ce module
déploie la **pile Chibisafe complète** — le backend chibisafe-server, l'interface
web Next.js et un proxy inverse Caddy, réunis dans une image construite sur
mesure et à l'écoute sur le port 8000 — sous la forme d'une seule charge de
travail sur **GKE Autopilot**, par défaut un StatefulSet adossé à un
PersistentVolumeClaim en mode bloc de 20Gi monté sur `/data` — plus adapté
que GCS Fuse à une application SQLite à écrivain unique. Ce lab vous fait
parcourir tout le cycle de vie opérationnel du module **Chibisafe on GKE
Autopilot** : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Chibisafe. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Chibisafe_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à l'interface web de Chibisafe.
- Comprendre pourquoi les sondes de santé ciblent `/api/health` plutôt que `/`,
  et quelles variables de sonde contrôlent réellement le pod déployé.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet, gérer le secret
  administrateur facultatif et comprendre les contraintes de stockage et de mise à l'échelle.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas
  besoin de le déployer vous-même au préalable — la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Chibisafe (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Chibisafe_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme construit et pousse l'image personnalisée chibisafe-server
   (épinglée à `v6.5.5` sauf si vous définissez une version précise), puis la
   déploie dans le cluster GKE Autopilot. Comme `stateful_pvc_enabled = true`
   par défaut, le type de charge de travail se résout automatiquement en
   **StatefulSet** avec un PVC en mode bloc `standard-rwo` de 20Gi monté sur
   `/data`. Un bucket Cloud Storage `storage` est toujours provisionné lui
   aussi, mais reste **non monté** tant que le PVC par défaut est actif (il
   n'est monté sur `/data` que si vous désactivez le PVC). Si
   `enable_api_key = true`, un secret de mot de passe administrateur est
   également créé dans Secret Manager et fourni sous forme de Secret Kubernetes
   natif. `enable_custom_domain
   = true` par défaut, si bien qu'une Gateway Kubernetes est provisionnée avant
   même que vous ne définissiez un domaine. Aucune instance Cloud SQL n'est
   créée — `database_type` est fixé à `NONE`. Un premier déploiement prend
   généralement **10 à 20 minutes** (le build de l'image personnalisée domine ;
   il n'y a aucune instance Cloud SQL à provisionner).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres
   indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep chibisafe | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute. Notez qu'il s'agit d'un
   **StatefulSet**, et non d'un Deployment :

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   ```

2. **Chemin des sondes de santé — corrigé, mais connaissez la structure.** Les
   variables `startup_probe`/`liveness_probe` de `Chibisafe_GKE` (groupe 10)
   valent par défaut **`/api/health`**, comme pour la variante CloudRun : ce
   chemin traverse le proxy Caddy du conteneur jusqu'au backend et renvoie
   littéralement un 200 `{"status":"yes"}`, alors que `/` est servi par
   l'interface web et ne sollicite pas le backend. Un nouveau déploiement sur
   une version actuelle du module doit atteindre `Ready` sans aucune
   surcharge. Deux points à connaître :
   - Il s'agissait *bien* d'un bogue latent — une version antérieure de
     `Chibisafe_GKE` laissait `startup_probe`/`liveness_probe` sur la valeur par
     défaut héritée `/` et, lorsque l'image ne livrait que le backend (aucune
     route sur `/`), les pods restaient indéfiniment non prêts, dans une boucle
     de plantages et de redémarrages. Le problème a depuis été corrigé au
     niveau des valeurs par défaut des variables ; vous ne devriez avoir besoin
     d'aucun contournement.
   - `health_check_config`/`startup_probe_config` (également dans le groupe 10)
     valent toujours `/` par défaut et le resteront — elles ne sont déclarées
     que pour refléter la fondation et ne sont **jamais transmises** à
     `App_GKE`. Les surcharger n'a **aucun effet** sur la sonde déployée ; les
     variables qui comptent réellement sont `startup_probe`/`liveness_probe`.

   Si vous observez malgré tout le symptôme ci-dessous sur un nouveau
   déploiement, traitez-le comme une véritable régression et non comme le
   problème connu historique — vérifiez les valeurs réelles de
   `startup_probe`/`liveness_probe` du pod avec `kubectl describe` :

   ```bash
   kubectl describe pod -n "$NS" <pod-name>
   # Events will show: Readiness probe failed / Liveness probe failed:
   # HTTP probe failed with statuscode: <non-200>
   # -> compare against the pod spec's actual probe path:
   kubectl get pod -n "$NS" <pod-name> -o jsonpath='{.spec.containers[0].livenessProbe.httpGet.path}'
   ```

3. Une fois le pod `Ready`, trouvez l'adresse externe de la charge de travail.
   Avec la valeur par défaut `enable_custom_domain = true` (Gateway), vous devez
   renseigner `application_domains` pour que le certificat géré s'y rattache ;
   vous pouvez aussi passer `service_type` à `LoadBalancer` pour obtenir une IP
   externe directe :

   ```bash
   kubectl get svc,gateway,httproute -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

4. Vérifiez le point de terminaison de santé (le port 8000 est celui de Caddy,
   qui relaie `/api/*` vers le backend) et l'interface web, depuis l'intérieur
   du cluster ou une fois accessible de l'extérieur :

   ```bash
   kubectl exec -n "$NS" <pod-name> -- wget -qO- http://localhost:8000/api/health
   # or, once externally reachable:
   curl -s "http://${EXTERNAL_IP}/api/health"   # expect HTTP 200, {"status":"yes"}
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 200 — the Chibisafe web UI
   ```

5. Ouvrez l'adresse de la charge de travail dans un navigateur — l'interface
   web de Chibisafe se charge (tableau de bord, connexion, téléversements,
   albums). L'API REST se trouve sous `/api` (la sortie `api_url` du module) et
   les fichiers téléversés sont servis par leur nom. Connectez-vous en tant
   qu'`admin` : par défaut (`enable_api_key = false`), le mot de passe initial
   est la valeur par défaut amont de Chibisafe (`admin`) — changez-le dès la
   première connexion. Redéployez avec `enable_api_key = true` pour que le
   module génère plutôt un `ADMIN_PASSWORD` aléatoire dans Secret Manager.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pods et PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas une réplique.** `min_instance_count = max_instance_count
   = 1` par défaut, et c'est une exigence stricte : Chibisafe est une
   application SQLite à écrivain unique et, même si chaque réplique du
   StatefulSet reçoit son propre PVC, la mise à l'échelle risque de créer des
   écrivains concurrents et un état incohérent.

3. **Mettez à jour la version de l'application** en modifiant le paramètre
   `application_version` dans la plateforme RAD et en l'appliquant via
   **Update** ; l'image est reconstruite avec l'argument de build épinglé
   `CHIBISAFE_VERSION` et le pod du StatefulSet est remplacé.

4. **Gérez le secret administrateur facultatif et inspectez l'état stocké** —
   SQLite, les fichiers téléversés et les journaux résident directement sur le
   PVC du pod (il n'existe aucun client de base de données auquel se connecter) :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~chibisafe"
   kubectl exec -n "$NS" <pod-name> -- ls -la /data/database /data/uploads /data/logs
   kubectl exec -n "$NS" <pod-name> -- df -h /data
   ```

5. **Notez le bucket de stockage non monté.** Un bucket Cloud Storage `storage`
   est toujours provisionné à côté du PVC, mais reste non monté tant que
   `stateful_pvc_enabled = true` (la valeur par défaut) — c'est le comportement
   attendu, pas une erreur :

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~chibisafe"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer)
   (notez le nommage propre au StatefulSet, différent de celui d'un Deployment) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation CPU et mémoire des pods, le nombre de redémarrages (surveillez
   le problème de sonde de santé décrit plus haut, qui se manifeste par des
   redémarrages répétés) et l'utilisation disque du PVC. Gardez un œil sur le
   quota régional `SSD_TOTAL_GB` si vous exécutez d'autres modules avec état à
   côté de Chibisafe — `standard-rwo` repose par défaut sur du SSD. Un contrôle
   de disponibilité (uptime check) est disponible mais **désactivé par défaut**
   (`uptime_check_config.enabled = false`).

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Chibisafe.

- **Pod bloqué non prêt / boucle de plantages et redémarrages :** `startup_probe`/`liveness_probe`
  valent par défaut `/api/health` (voir la tâche 2), cela ne devrait donc pas se
  produire sur un nouveau déploiement. Si `kubectl describe pod` montre des
  échecs de sonde sur le chemin `/`, quelque chose a surchargé
  `startup_probe`/`liveness_probe` — rétablissez-les à `/api/health`, qui
  sollicite le proxy et le backend. Vérifiez les surcharges de `environment_variables`/des sondes dans la configuration
  de votre déploiement ; ne prenez **pas** la peine de surcharger `health_check_config`/
  `startup_probe_config`, elles sont inertes et n'atteignent jamais la spécification du pod.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe failures
  kubectl logs -n "$NS" <pod> --previous       # confirm the process actually started
  kubectl get pod -n "$NS" <pod> -o jsonpath='{.spec.containers[0].livenessProbe.httpGet.path}'
  ```
- **PVC bloqué en `Pending` / `Quota 'SSD_TOTAL_GB' exceeded` :** la StorageClass
  par défaut `standard-rwo` repose sur du SSD et consomme un quota régional
  restreint. Surchargez `stateful_pvc_storage_class = "standard"` (HDD) — le
  profil d'écriture SQLite/médias de Chibisafe n'a pas besoin des IOPS d'un
  SSD. Récupérer du quota impose de supprimer le PVC ou le namespace ; réduire
  à zéro ne le libère pas.
- **La Gateway / le certificat géré ne se rattache jamais :** vérifiez que
  `application_domains` est renseigné — `enable_custom_domain = true` est actif
  par défaut, mais la Gateway n'a aucun nom d'hôte auquel lier un certificat
  tant que vous n'en avez pas défini un.
- **Les données semblent réinitialisées après un redéploiement :** vérifiez que
  `stateful_pvc_enabled` vaut toujours `true` et que `stateful_pvc_mount_path`
  vaut toujours `/data` — les liens symboliques de relocalisation du point
  d'entrée sont codés en dur sur ce chemin.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (notamment la structure des variables de
sonde de santé décrite plus haut, le compromis lié au quota SSD et les
variables inertes `enable_redis` / `container_port`).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail StatefulSet
et son namespace, son PVC, le bucket Cloud Storage et le secret de mot de passe
administrateur facultatif. Il n'y a aucune base de données Cloud SQL à
supprimer — aucune n'a jamais été créée. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, Artifact Registry) sont gérées
séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image personnalisée et déploie un StatefulSet avec un PVC en mode bloc de 20Gi sur `/data`, un bucket GCS non monté et un secret administrateur facultatif — sans Cloud SQL |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; confirmer que les sondes `/api/health` permettent au pod d'atteindre l'état Ready ; l'interface web de Chibisafe se charge sur `/` ; se connecter en tant qu'`admin` et changer le mot de passe |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, mettre à jour la version, gérer le secret administrateur, inspecter SQLite/fichiers téléversés/journaux sur le PVC ; ne jamais dépasser 1 réplique |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques des pods/du PVC et le contrôle de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les régressions de chemin de sonde, le quota PVC/SSD, la Gateway/le certificat et les problèmes de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime le StatefulSet, le PVC, le bucket et le secret facultatif |
