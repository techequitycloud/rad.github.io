---
title: "Navidrome sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Navidrome sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Navidrome_GKE.md @ 3055034 sha256:25361e4423e8 -->

# Navidrome sur GKE Autopilot — Guide de lab {#navidrome-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Navidrome_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Navidrome est un serveur de streaming musical gratuit, open source, auto-hébergé et compatible Subsonic,
écrit en Go. Il ne dispose d'aucune base de données externe — l'intégralité de son état (bibliothèque,
utilisateurs, playlists) réside dans un fichier SQLite intégré qui, sur GKE, repose sur un véritable
Persistent Disk en mode bloc plutôt que sur un système de fichiers réseau. Ce lab vous fait parcourir
l'intégralité du cycle de vie opérationnel du module **Navidrome on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Navidrome. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Navidrome_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail StatefulSet en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter le pod et le PVC, monter une bibliothèque musicale, et
  gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module — Navidrome lui-même n'a besoin d'aucune
  instance Cloud SQL). Vous n'avez pas besoin de le déployer vous-même au préalable — la
  plateforme détecte automatiquement s'il existe déjà dans le projet cible
  et, sinon, le provisionne avant ce module (voir la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Navidrome (GKE)**
   depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id`
   et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Navidrome_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous forme de
   **StatefulSet** (résolu automatiquement car `stateful_pvc_enabled = true`), provisionne
   un PersistentVolumeClaim en mode bloc de 20Gi sur `/data` (SSD `standard-rwo` par défaut —
   il contient la base de données SQLite, le cache de métadonnées et l'index de recherche), un secret
   Secret Manager avec un mot de passe administrateur généré (matérialisé dans l'espace de noms
   sous forme de Secret Kubernetes natif), et réplique l'image `deluan/navidrome` dans
   Artifact Registry. Il n'y a **ni instance Cloud SQL ni Job d'initialisation/de migration**
   — Navidrome crée son propre schéma SQLite au premier démarrage. Les premiers déploiements se terminent
   généralement en **5–15 minutes**, bien plus vite qu'un module adossé à une base de données.

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep navidrome | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   ```

   Vérifiez que le type de charge de travail indique `StatefulSet` (et non `Deployment`) — c'est ce qui
   donne à Navidrome un véritable PVC en stockage bloc, plutôt que le compromis FUSE éphémère
   retenu par la variante Cloud Run.

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod s'exécute et recherchez une adresse externe (il n'y en a aucune par
   défaut — `service_type = ClusterIP`) :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: ${EXTERNAL_IP:-<none — ClusterIP only>}"
   ```

2. Sans entrée externe configurée, atteignez le service via une redirection de port et
   vérifiez le point de terminaison de ping non authentifié :

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NS" "svc/$SVC" 4533:4533 &
   curl -s http://localhost:4533/ping   # expect {"status":"ok"}
   kill %1
   ```

3. Récupérez le mot de passe administrateur généré dans Secret Manager (il est également répliqué
   sous forme de Secret Kubernetes natif dans l'espace de noms) :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~navidrome-admin-password"
   gcloud secrets versions access latest --secret=<admin-password-secret-name> --project="$PROJECT"
   kubectl get secrets -n "$NS" | grep navidrome
   ```

4. Connectez-vous en tant que `admin` avec le mot de passe récupéré via la redirection de port (ou
   l'adresse externe une fois configurée) et changez le mot de passe après la première connexion.
   Si `enable_admin_password = false` a été choisi à la place, terminez vous-même immédiatement
   l'assistant de configuration du premier lancement.

5. La bibliothèque musicale reste vide tant que vous n'en montez pas une. Ajoutez une entrée `gcs_volumes` avec
   `mount_path = "/music"` (la lecture seule convient — aucun état SQLite n'y réside), ou
   activez NFS (`enable_nfs = true`, `nfs_mount_path = "/music"`) pour une bibliothèque partagée
   accessible en écriture, puis appliquez via **Update**.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, le pod et le PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count = 1` et
   `max_instance_count = 1` sont tous deux fixés par conception — Navidrome n'a pas de
   mode SQLite multi-écrivains, et le PVC est lié à l'identité StatefulSet stable du pod
   (`<service-name>-0`). La mise à l'échelle est un paramètre de configuration de la
   page de détails du déploiement, et non une valeur à modifier avec un `kubectl scale` manuel
   (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et le pod unique
   est remplacé.

4. **Gérez les secrets et le stockage :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~navidrome"
   kubectl get pvc -n "$NS"
   gcloud compute disks list --project="$PROJECT" --filter="name~navidrome"
   ```

5. **Vérifiez le montage de la bibliothèque musicale et la configuration en cours d'exécution :**

   ```bash
   kubectl exec -n "$NS" statefulset/"$SVC" -- env | grep ^ND_
   kubectl exec -n "$NS" statefulset/"$SVC" -- ls /music
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$SVC" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods (Navidrome conserve son index de recherche en mémoire — surveillez-la avec
   une bibliothèque volumineuse), le nombre de redémarrages et l'utilisation du PVC/disque sous Compute Engine →
   Disks. Un test de disponibilité (uptime check) facultatif peut être provisionné une fois qu'une entrée externe
   (`application_domains` ou `service_type = LoadBalancer`) est configurée ; consultez-le
   sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Navidrome.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage
  et de vivacité ciblent toutes deux `GET /ping`, un point de terminaison non authentifié.
  ```bash
  kubectl describe pod -n "$NS" -l app="$SVC"        # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" -l app="$SVC" --previous      # logs from the crashed container
  ```
- **PVC bloqué en `Pending` / `Quota 'SSD_TOTAL_GB' exceeded` :** la valeur par défaut
  `stateful_pvc_storage_class = standard-rwo` repose sur du SSD et consomme le quota SSD
  régional, très limité. Passez à `-var stateful_pvc_storage_class=standard` (HDD
  `pd-standard`) si une vague plus large d'applications avec état l'a épuisé — le `/data`
  de Navidrome est dimensionné pour des métadonnées/un index, et non pour des médias volumineux ; le HDD est donc une solution de repli sûre.
- **Bibliothèque vide / aucun morceau trouvé :** vérifiez qu'une entrée `gcs_volumes` ou un montage NFS est
  bien rattaché à `/music` — rien n'y est monté par défaut.
- **Aucun accès externe :** `service_type = ClusterIP` et un `application_domains` vide
  sont les valeurs par défaut — le service n'est joignable qu'à l'intérieur du cluster/VPC tant que vous n'avez pas défini l'un
  des deux.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment pourquoi `stateful_pvc_enabled` doit rester
`true` et pourquoi `max_instance_count` ne doit jamais dépasser 1).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Delete supprime tout ce que le module a créé — le StatefulSet Kubernetes
et son espace de noms, le PersistentVolumeClaim `/data` et le Persistent Disk sous-jacent
(**cela supprime définitivement les métadonnées de la bibliothèque musicale, les utilisateurs et les playlists** —
il n'existe aucun Cloud SQL à sauvegarder séparément), le bucket Cloud Storage `storage`
toujours créé, le secret Secret Manager du mot de passe administrateur et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud
SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet GKE avec un PVC en mode bloc sur `/data`, un secret de mot de passe administrateur, et réplique l'image — ni Cloud SQL, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; la vérification d'état (`/ping`) réussit via une redirection de port ; récupérer le mot de passe administrateur et se connecter ; monter une bibliothèque musicale sur `/music` |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/le pod/le PVC, maintenir la mise à l'échelle à 1/1, mettre à jour la version, gérer les secrets/le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et l'utilisation du PVC/disque |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota SSD, de bibliothèque vide, d'entrée et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC et son Persistent Disk |
