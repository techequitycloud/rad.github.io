---
title: "Beszel sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Beszel sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Beszel_GKE.md @ 3055034 sha256:aed245761922 -->

# Beszel sur GKE Autopilot — Guide de lab {#beszel-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Beszel_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Beszel est un hub de supervision de serveurs léger et open source — métriques historiques de ressources, statistiques des conteneurs Docker et alertes configurables, construit sur PocketBase avec une base de données SQLite intégrée. Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Beszel on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Beszel. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Beszel_GKE) — ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder au StatefulSet en cours d'exécution.
- Accéder au hub, le vérifier et effectuer la configuration administrateur initiale.
- Effectuer les opérations du jour 2 — inspecter la charge de travail, gérer le PVC SQLite et mettre à jour la version.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Beszel (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Beszel_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme planifie un **StatefulSet** à réplique unique sur le cluster GKE Autopilot
   (un conteneur Go sur le port 8090), provisionne un **Persistent
   Volume** de type bloc de 20 Gi monté sur `/beszel_data` pour la base de données SQLite intégrée, et met en miroir
   l'image Beszel dans Artifact Registry. **Aucun Cloud SQL, aucun Redis et aucun
   job d'initialisation n'est créé** — Beszel est autonome ; le déploiement est donc rapide
   (généralement **10 à 20 minutes**, sans provisionnement Cloud SQL à attendre).

3. Connectez-vous au cluster et repérez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep beszel | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod s'exécute et déterminez comment le Service est exposé. Beszel utilise par défaut
   `LoadBalancer` ; une adresse IP externe est donc provisionnée d'emblée (son attribution peut prendre
   une à deux minutes) ; un domaine personnalisé est une voie supplémentaire, optionnelle :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: ${EXTERNAL_IP:-<none — ClusterIP only, use port-forward or a custom domain>}"
   ```

2. Si aucune adresse externe n'est encore exposée, atteignez le hub avec une redirection de port :

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NS" "svc/$SVC" 8090:8090 &
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8090/api/health"   # expect 200
   ```

   Le chemin de santé de Beszel est `/api/health`, un point de terminaison public et non authentifié qui
   renvoie HTTP 200 une fois le hub prêt (le premier démarrage crée le schéma SQLite ;
   prévoyez donc jusqu'à une minute sur un nouveau déploiement — la fenêtre de nouvelles tentatives de la sonde de démarrage
   couvre déjà ce délai).

3. Ouvrez le hub dans un navigateur (via l'adresse IP externe ou le domaine personnalisé, ou
   `http://localhost:8090` via la redirection de port). Au premier démarrage, Beszel présente
   la **configuration du superutilisateur (administrateur)** initiale de PocketBase — saisissez une adresse e-mail et
   un mot de passe administrateur pour la terminer. Aucun identifiant administrateur n'est stocké dans Secret Manager ; le
   compte que vous créez ici réside dans la base de données SQLite sur le PVC.

4. Après avoir créé l'administrateur, ajoutez un système à superviser : le hub affiche la commande
   d'installation de l'agent et sa clé publique. Installez l'agent Beszel sur une machine que vous
   souhaitez surveiller et confirmez qu'il commence à envoyer ses données à l'URL du hub. Notez que les agents
   situés hors du cluster ne peuvent atteindre le hub que s'il est exposé à l'extérieur
   (`service_type` défini sur `LoadBalancer`, ou un domaine personnalisé via Ingress) — un simple
   `ClusterIP` ne sert que les autres charges de travail du cluster.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail :**

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

2. **La mise à l'échelle est volontairement figée.** Beszel s'exécute avec `min_instance_count = 1` et
   `max_instance_count = 1` — un pod, un seul processus d'écriture SQLite. **N'augmentez pas
   `max_instance_count`** : plusieurs pods sur le PVC partagé risquent des conflits de
   verrouillage et une corruption de la base de données ; une garde au moment du plan rejette également
   `min_instance_count > max_instance_count`. Toute modification est une modification de
   configuration effectuée via **Update** sur la page de détails du déploiement, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via
   **Update** sur la page de détails du déploiement ; une nouvelle image est mise en miroir et le
   StatefulSet remplace l'unique pod (un seul pod peut détenir le PVC à la fois ;
   il s'agit donc d'un remplacement, et non d'une mise à jour progressive sur deux pods). Beszel migre
   automatiquement sa base de données intégrée lors de la mise à niveau. Figez une étiquette explicite plutôt
   que `latest` pour maîtriser le moment où cela se produit.

4. **Inspectez l'état qui compte — le PVC.** Le Persistent Volume *est* la
   base de données (fichier SQLite, configuration, historique des métriques) :

   ```bash
   kubectl get pvc -n "$NS"
   kubectl describe pvc -n "$NS" <pvc-name>
   gcloud compute disks list --project="$PROJECT" --filter="name~beszel"
   ```

   Traitez-le comme des données de production : ne supprimez jamais le StatefulSet avec son PVC, ni
   le disque sous-jacent, tant que le déploiement existe — cela effacerait tout
   l'historique de supervision et le compte administrateur.

5. **Secrets et jobs** — Beszel n'injecte aucun secret applicatif (aucune clé de
   chiffrement, aucun secret JWT ni mot de passe de base de données à gérer ; la base est une base SQLite intégrée et
   l'administrateur est créé dans l'interface), et il n'y a pas de job d'initialisation :

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~beszel"
   kubectl get jobs -n "$NS"          # expect none by default
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (lorsqu'il est activé) sur `/api/health` ; examinez
   Monitoring → Uptime checks et Alerting → Policies. (Remarque : cette surveillance
   GCP observe le *hub* ; Beszel lui-même supervise les machines sur lesquelles s'exécutent ses agents
   — ce n'est pas la même chose.)

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Beszel.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et
  de vivacité ciblent `/api/health`, avec une fenêtre de nouvelles tentatives qui couvre
  la création du schéma au premier démarrage :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod bloqué à l'état Pending / PVC non lié :** vérifiez l'épuisement du quota SSD de GKE
  (`SSD_TOTAL_GB`) ou des problèmes de planification des ressources :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pod -n "$NS" <pod>          # look for "Quota exceeded" or FailedScheduling events
  ```
- **Historique disparu après un redémarrage du pod / un redéploiement :** confirmez que c'est le même PVC (et non un
  nouveau) qui a été rattaché, et que le StatefulSet n'a pas été mis à l'échelle au-delà de 1 ni son
  PVC supprimé :
  ```bash
  kubectl get pvc -n "$NS"
  gcloud compute disks list --project="$PROJECT" --filter="name~beszel"
  ```
- **Les agents ne parviennent pas à envoyer leurs données :** confirmez que le Service est réellement joignable depuis
  l'extérieur du cluster (`service_type = LoadBalancer` ou un domaine personnalisé via
  Ingress) — un Service `ClusterIP` ne sert que le trafic interne au cluster ; les agents
  externes ne pourront donc pas se connecter. Confirmez aussi que IAP est **désactivé** — IAP bloque toutes les
  requêtes non authentifiées, y compris les envois de métriques des agents depuis des machines qui
  ne peuvent pas présenter d'identité Google.
- **Base de données verrouillée / erreurs intermittentes :** vérifiez le nombre de pods. Si
  `max_instance_count` a été porté au-delà de 1, deux processus d'écriture se disputent un même
  fichier SQLite sur le même PVC — remettez-le immédiatement à 1 via **Update**.
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry
  (`enable_image_mirroring = true` met en miroir l'image en amont) et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (y compris les règles essentielles de ne jamais supprimer le PVC
et de ne jamais porter `max_instance_count` au-delà de 1).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — le StatefulSet Kubernetes
et le namespace, le Persistent Volume (qui **est** la base de données SQLite — tout
l'historique de supervision et le compte administrateur disparaissent avec lui) et les images Artifact
Registry mises en miroir. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie un StatefulSet à réplique unique (port 8090), un PVC de 20 Gi sur `/beszel_data`, et met l'image en miroir — sans base de données, ni Redis, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | `/api/health` renvoie 200 ; terminer la configuration du superutilisateur PocketBase et connecter un agent |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, respecter le blocage à une seule réplique, mettre à jour la version, inspecter le PVC |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC/quota, d'entrée des agents, de verrou SQLite et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC |
