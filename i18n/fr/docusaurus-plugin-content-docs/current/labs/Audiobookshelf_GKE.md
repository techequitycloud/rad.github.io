---
title: "Audiobookshelf sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Audiobookshelf sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Audiobookshelf_GKE.md @ 3055034 sha256:98ec7e7257b8 -->

# Audiobookshelf sur GKE Autopilot — Guide de lab {#audiobookshelf-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Audiobookshelf_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Audiobookshelf est un serveur auto-hébergé de livres audio et de podcasts, doté d'une interface web, d'applications
mobiles et d'une synchronisation de la progression d'écoute par utilisateur. Ce lab vous accompagne tout au long du
cycle de vie opérationnel du module **Audiobookshelf sur GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Audiobookshelf. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisé par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Audiobookshelf_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle (dans la limite d'un rédacteur unique),
  mettre à jour, et gérer le volume de stockage en mode bloc.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant qu'Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour ne comportent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Audiobookshelf (GKE)**
   dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Audiobookshelf_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. `service_type` vaut désormais par défaut
   `LoadBalancer` ; une IP externe directement joignable est donc provisionnée d'emblée
   (un domaine personnalisé est également activé par défaut et fournit son propre chemin externe).
   Ne définissez `service_type = "ClusterIP"` que si vous souhaitez délibérément le rendre interne au cluster. Cliquez sur **Deploy Module**,
   vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail dans le cluster GKE Autopilot sous la forme d'un
   **StatefulSet** doté d'un **Persistent Volume Claim** en mode bloc par pod, monté sur
   `/data`, construit une image de conteneur légère qui enveloppe l'image amont
   (`FROM ghcr.io/advplyr/audiobookshelf`) dans Artifact Registry, et réserve une
   IP externe statique. Il n'y a **ni base de données Cloud SQL, ni Redis, ni
   job d'initialisation** — Audiobookshelf initialise lui-même sa base de données SQLite au
   premier démarrage, directement sur le volume persistant. Sans base de données à provisionner,
   les premiers déploiements prennent environ **15–25 minutes** (le build de l'image par Cloud Build et
   le provisionnement du PVC représentent l'essentiel de la durée).

3. Connectez-vous au cluster et repérez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep audiobookshelf | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et repérez le pod et le PVC du StatefulSet :

   ```bash
   kubectl get pods,svc,statefulset,pvc -n "$NS"
   SERVICE=$(kubectl get svc -n "$NS" -o jsonpath='{.items[?(@.metadata.labels.application=="audiobookshelf")].metadata.name}')
   echo "Service: $SERVICE"
   ```

2. Vérifiez que le service est en bonne santé. Le chemin de santé d'Audiobookshelf est `/healthcheck`,
   un point de terminaison renvoyant 200 sans authentification (la sonde de démarrage tolère jusqu'à 10 échecs à
   intervalle de 10 secondes après un délai initial de 15 secondes — soit environ 115 secondes de délai
   au premier démarrage) :

   ```bash
   kubectl exec -n "$NS" statefulset/"$SERVICE" -- wget -qO- http://localhost:80/healthcheck
   # or, without exec:
   kubectl port-forward -n "$NS" svc/"$SERVICE" 8080:80 &
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthcheck   # expect 200
   ```

3. Trouvez l'adresse externe. Si `service_type = LoadBalancer`, lisez l'IP du
   Service ; si vous avez conservé le chemin par défaut domaine personnalisé / IP statique, lisez plutôt l'adresse
   réservée :

   ```bash
   kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}'
   gcloud compute addresses list --project="$PROJECT" --filter="name~audiobookshelf"
   ```

4. Ouvrez l'adresse (ou le domaine personnalisé configuré) dans un navigateur. Au premier démarrage,
   Audiobookshelf présente son **assistant de configuration initiale** — créez l'utilisateur
   **root** (administrateur) initial avec un mot de passe robuste. Il n'y a aucun identifiant généré à
   récupérer : ce module ne crée **aucun secret d'application** (pas de mot de passe de base de données,
   pas de clé maîtresse). Les jetons d'API pour les applications mobiles ou l'automatisation sont générés ultérieurement dans
   l'interface web.

5. Durcissement immédiat : comme le compte administrateur est créé par la première personne qui atteint
   l'assistant, effectuez l'étape 4 juste après le déploiement — ou restreignez l'accessibilité
   (définissez `service_type = ClusterIP` — la valeur par défaut est `LoadBalancer`, il s'agit donc d'une modification explicite et non de la situation actuelle — ou placez le domaine personnalisé derrière IAP) en
   attendant.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pod et PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS" "$SERVICE"
   ```

2. **Mise à l'échelle — à proscrire.** `min_instance_count` et `max_instance_count` sont tous deux fixés
   à `1` par conception : Audiobookshelf sert une bibliothèque SQLite partagée unique depuis un seul
   volume en mode bloc à rédacteur unique, et un second pod écrivant sur le même PVC risque de corrompre la base de données
   et l'index des médias. Augmenter `max_instance_count` via **Update** est le
   seul moyen de modifier cela, et ce n'est **pas pris en charge** par l'application.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   via **Update** sur la page de détails du déploiement ; Cloud Build produit une nouvelle image
   (à l'aide de l'ARG de build propre à l'application `AUDIOBOOKSHELF_VERSION`) et la mise à jour progressive
   `OrderedReady` du StatefulSet remplace l'unique pod. Notez que `latest` correspond à une
   version épinglée (`2.17.0` au moment de la rédaction) — épinglez une étiquette explicite pour maîtriser
   délibérément les mises à niveau.

4. **Gérez le volume persistant et les jobs :**

   ```bash
   kubectl get pvc -n "$NS"
   kubectl describe pvc -n "$NS" -l app="$SERVICE"
   gcloud compute disks list --project="$PROJECT" --filter="name~audiobookshelf"
   kubectl get jobs -n "$NS"          # none by default; only present if you added custom jobs
   gcloud secrets list --project="$PROJECT" --filter="name~audiobookshelf"   # expect none — no app secrets
   ```

5. **Sauvegardez l'état** à la demande en copiant le contenu du volume monté (le module
   prend également en charge une sauvegarde planifiée via `backup_schedule`) :

   ```bash
   kubectl exec -n "$NS" statefulset/"$SERVICE" -- tar czf - -C /data . \
     > "audiobookshelf-data-$(date +%F).tar.gz"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$SERVICE" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods (les analyses de bibliothèque sont les pics à surveiller), le nombre de redémarrages et
   l'utilisation du PVC. Le module peut provisionner un **test de disponibilité** (uptime check) (désactivé par défaut,
   chemin `/healthcheck`) lorsque le point de terminaison est joignable publiquement — examinez Monitoring
   → Uptime checks et Alerting → Policies après l'avoir activé.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Audiobookshelf à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de démarrage
  cible `/healthcheck` ; un problème de montage du PVC ou un fichier SQLite corrompu
  empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod bloqué en `Pending` avec un événement lié au PVC :** recherchez un problème de StorageClass ou
  un épuisement du quota SSD régional — les PVC en mode bloc de GKE utilisent par défaut la StorageClass
  `standard-rwo` adossée à des SSD, qui puise dans le quota `SSD_TOTAL_GB` (souvent serré),
  et ramener une application avec état à zéro ne libère **pas** son PVC.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # look for "Quota 'SSD_TOTAL_GB' exceeded"
  kubectl get pvc -n "$NS"
  ```
  Dans ce cas, redéployez (ou mettez à jour, lorsque c'est possible) avec
  `-var stateful_pvc_storage_class=standard` (HDD `pd-standard`) — la charge de travail
  SQLite/médias d'Audiobookshelf n'a pas besoin des IOPS d'un SSD. Récupérer un quota SSD déjà consommé
  nécessite de supprimer le PVC, et pas seulement de ramener la charge à zéro.
- **Pas d'accessibilité externe :** `service_type` vaut `LoadBalancer` par défaut ; une
  IP externe devrait donc être attribuée (cela peut prendre une minute ou deux) ; un Service accessible uniquement
  au sein du cluster signifie qu'il a été explicitement défini sur `ClusterIP`. Vérifiez le type de Service et,
  si vous utilisez le chemin de domaine personnalisé,
  que la Gateway / le certificat géré a bien été provisionné :
  ```bash
  kubectl get svc,gateway -n "$NS"
  kubectl describe managedcertificate -n "$NS"
  ```
- **Corruption de la base de données ou de l'index des médias :** presque toujours causée par plus d'un
  rédacteur sur `/data`. Vérifiez que `max_instance_count = 1` et qu'aucun
  `kubectl scale` manuel n'a été appliqué (une mise à l'échelle manuelle est annulée lors du prochain apply, mais
  peut causer des dégâts entre-temps).
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry (Cloud Build
  enveloppe `ghcr.io/advplyr/audiobookshelf` dans votre registre) et que le compte de service
  des nœuds peut la récupérer :
  ```bash
  gcloud builds list --project="$PROJECT" --limit=5
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project="$PROJECT"
  ```

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment le choix de StorageClass lié au quota SSD et la raison pour laquelle
`max_instance_count` doit rester à `1`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (elle fait oublier le déploiement à RAD). La suppression retire tout ce que le module a créé — le StatefulSet Kubernetes
et l'espace de noms, le Persistent Volume Claim en mode bloc (et le Persistent Disk
sous-jacent — la base de données SQLite et toutes les métadonnées de la bibliothèque), l'IP statique réservée et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet à pod unique avec un PVC en mode bloc sur `/data`, construit l'image et réserve une IP statique — pas de base de données, pas de secrets |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; `/healthcheck` renvoie 200 ; créer l'utilisateur root dans l'assistant de configuration initiale |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC, maintenir les réplicas à 1 (SQLite à rédacteur unique), mettre à jour la version, sauvegarder `/data` |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota SSD, d'accès entrant et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC/disque |
