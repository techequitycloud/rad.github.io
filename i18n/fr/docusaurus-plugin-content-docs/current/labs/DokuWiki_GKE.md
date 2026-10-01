---
title: "DokuWiki sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez DokuWiki sur GKE Autopilot dans votre propre projet Google Cloud — installation guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/DokuWiki_GKE.md @ 3055034 sha256:8fc7c9bb72f7 -->

# DokuWiki sur GKE Autopilot — Guide de lab {#dokuwiki-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/DokuWiki_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

DokuWiki est un **wiki à fichiers plats** léger et conforme aux standards — il stocke toutes
les pages, les médias, les utilisateurs et la configuration sous forme de fichiers sur disque, sans base de données. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **DokuWiki on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit DokuWiki. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/DokuWiki_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle (délibérément pas), mettre à jour, et gérer
  le PVC de type bloc qui contient tout le contenu du wiki.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe
  déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
  DokuWiki n'utilise aucune base de données, Cloud SQL n'est donc pas requis pour ce module.
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **DokuWiki (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/DokuWiki_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, par exemple la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie DokuWiki dans le cluster GKE Autopilot sous la forme d'un
   **StatefulSet** adossé à un PersistentVolumeClaim de type bloc durable, monté sur
   `/storage` (`10Gi` par défaut), et construit/réplique l'image de conteneur. Il n'y a
   **aucune base de données** (`database_type = "NONE"`), **pas de Redis** et **aucun secret
   d'exécution** — le compte administrateur est créé plus tard de manière interactive, via le
   programme d'installation. Les premiers déploiements prennent généralement **10–20 minutes** (aucun provisionnement
   Cloud SQL à attendre).

3. Connectez-vous au cluster et découvrez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep dokuwiki | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod du StatefulSet est en cours d'exécution et trouvez l'adresse externe du wiki :

   ```bash
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le wiki est en bonne santé. Les sondes de démarrage, de vivacité et de disponibilité ciblent toutes
   `/`, que DokuWiki sert sans authentification — le pod devient Ready dès
   qu'Apache est lancé (aucune migration de base de données à attendre) :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}/install.php` dans un navigateur pour exécuter le **programme
   d'installation initial** — définissez le titre du wiki, créez le compte administrateur et choisissez
   la politique ACL. Le compte est écrit directement sur le PVC `/storage` ; il n'existe
   aucun identifiant administrateur pré-provisionné dans Secret Manager. **Immédiatement après la
   configuration, bloquez tout accès ultérieur à `install.php`** — quiconque y accède avant
   que vous ayez terminé la configuration peut s'approprier le compte administrateur. `install.php` fait partie
   de la racine web de l'image DokuWiki (et non du PVC `/storage`), il survit donc aux redémarrages
   du pod ; bloquez-le au niveau de l'équilibreur de charge / de l'ingress (une règle de refus
   basée sur le chemin) ou via une modification ultérieure de l'image, plutôt que d'essayer de le supprimer du
   conteneur en cours d'exécution.

   ```bash
   kubectl get ingress -n "$NS"          # check for an ingress you can add a deny rule to
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, les pods et le PVC associé :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas 1 réplica.** Chaque pod du StatefulSet reçoit son propre PVC
   distinct — DokuWiki n'a ni clustering intégré ni stockage partagé, si bien qu'un deuxième
   réplica ne reproduit pas le premier ; il démarre un wiki vide. Laissez
   `min_instance_count` / `max_instance_count` à `1` dans la plateforme RAD pour un
   wiki partagé. La mise à l'échelle (si elle s'avérait nécessaire pour un cas d'usage multi-wiki délibéré) est un
   changement de configuration via **Update**, et non un `kubectl scale` manuel — le module
   est propriétaire de la spécification de la charge de travail et une modification manuelle serait annulée lors de l'application suivante.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et déployée.
   DokuWiki n'a pas d'étape de migration — le nouveau moteur lit les mêmes données `/storage`.

4. **Inspectez le PVC et parcourez le contenu du wiki :**

   ```bash
   kubectl describe pvc -n "$NS"
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- ls -la /storage/data/pages
   kubectl exec -n "$NS" "$POD" -- du -sh /storage
   ```

5. **Sauvegardez le wiki** avant toute modification risquée (il n'y a pas de base de données à exporter —
   le PVC constitue l'intégralité du wiki) :

   ```bash
   kubectl exec -n "$NS" "$POD" -- tar czf /tmp/dokuwiki-backup.tar.gz -C /storage .
   kubectl cp "$NS/$POD:/tmp/dokuwiki-backup.tar.gz" ./dokuwiki-backup.tar.gz
   ```

6. **Vérifiez qu'il n'y a ni secrets ni jobs à gérer** (c'est le cas par conception pour
   ce module) :

   ```bash
   kubectl get secrets -n "$NS"
   kubectl get jobs -n "$NS"          # expect none — no init job for DokuWiki
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et l'utilisation du disque du PVC. Le module peut
   provisionner un **uptime check** (lorsque le point de terminaison est accessible publiquement) ; examinez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de DokuWiki.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Comme la sonde
  cible `/` sans authentification ni dépendance à une base de données, un échec de disponibilité indique presque
  toujours un problème de planification, de récupération d'image ou de montage du PVC plutôt qu'une
  erreur applicative.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod en attente / PVC non lié :** vérifiez l'état et les événements du PVC ; sur un
  projet soumis à des quotas, une StorageClass utilisant le SSD par défaut peut épuiser le
  quota SSD régional plus vite que prévu.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
- **Contenu du wiki « réinitialisé » ou vide après une modification :** vérifiez que vous n'avez pas supprimé ni
  remplacé le PVC (ou le StatefulSet avec son PVC) — le PVC *est* le
  wiki. Recréer le StatefulSet seul ne touche pas au PVC, mais supprimer le
  PVC ou le namespace entier, si.
- **Plusieurs réplicas affichent un contenu différent :** c'est attendu, et non un bogue — chaque
  pod du StatefulSet possède son propre PVC. Revenez à 1 réplica pour un wiki partagé.
- **`install.php` toujours accessible / administrateur non créé :** reprenez la tâche 2 — vérifiez
  que le programme d'installation s'est réellement exécuté et a écrit dans `/storage`, et que le fichier a été
  supprimé ou bloqué ensuite.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour
  détecter des problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer s'est vu attribuer une
  IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (y compris la règle essentielle de conserver `database_type =
"NONE"`, de ne jamais modifier `stateful_pvc_mount_path` pour l'éloigner de `/storage`, et de ne jamais
définir `workload_type = "Deployment"` en même temps que `stateful_pvc_enabled = true`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes,
le namespace et le PVC de type bloc contenant tout le contenu du wiki (sauvegardez-le d'abord si vous
devez le conserver — voir la tâche 3), ainsi que les images Artifact Registry. Les ressources appartenant
à **Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées séparément
et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet avec un PVC de type bloc (`/storage`) et construit l'image ; aucune base de données, aucun secret |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé répond ; exécuter l'assistant `/install.php` puis le bloquer |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, conserver 1 réplica, mettre à jour la version, parcourir/sauvegarder le PVC |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et l'uptime check |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, de contenu des réplicas et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire la charge de travail et le PVC — sauvegardez d'abord le contenu |
