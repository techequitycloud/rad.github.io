---
title: "Appsmith sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Appsmith sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Appsmith_GKE.md @ 3055034 sha256:d4c1efb29913 -->

# Appsmith sur GKE Autopilot — Guide de lab {#appsmith-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Appsmith_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Appsmith est une plateforme low-code open source permettant de créer des outils internes, des panneaux
d'administration et des tableaux de bord — une alternative auto-hébergée à Retool. La Community
Edition est livrée sous la forme d'un unique conteneur « monolithique » qui regroupe un MongoDB intégré,
Redis, le backend Java et le client React derrière nginx, et conserve tout l'état
de l'application sur un seul PersistentVolumeClaim. Ce lab vous accompagne tout au long du
cycle de vie opérationnel du module **Appsmith sur GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Appsmith. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisé par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Appsmith_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la
durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter le pod du StatefulSet et ses données
  persistées, mettre à jour la version et gérer les secrets.
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

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Appsmith
   (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Appsmith_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot sous la forme d'un
   **StatefulSet** (sélectionné automatiquement parce que `stateful_pvc_enabled = true`),
   provisionne un PersistentVolumeClaim de 20Gi monté sur `/appsmith-stacks`,
   génère les secrets Secret Manager (`APPSMITH_ENCRYPTION_PASSWORD`,
   `APPSMITH_ENCRYPTION_SALT`, `APPSMITH_SUPERVISOR_PASSWORD`) et met en miroir l'image
   préconstruite `appsmith/appsmith-ce` depuis Docker Hub vers Artifact
   Registry. Il n'y a **ni instance Cloud SQL ni tâche d'initialisation de base de données** —
   Appsmith CE exécute ses propres MongoDB et Redis intégrés et s'initialise lui-même au
   premier démarrage. Comptez **10–20 minutes** pour le premier déploiement ; le conteneur monolithique
   lui-même démarre lentement (Mongo, Redis et le backend Java intégrés démarrent tous
   dans un seul pod).

3. Connectez-vous au cluster et repérez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep appsmith | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe. Comme
   Appsmith est un **StatefulSet** à réplica unique, attendez-vous à exactement un pod (avec un
   nom stable, suffixé par un ordinal) :

   ```bash
   kubectl get statefulset,pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Appsmith expose un point de terminaison de santé qui
   répond une fois que le MongoDB intégré, Redis et le backend Java ont tous
   démarré — cela peut prendre plusieurs minutes au premier démarrage, c'est pourquoi la
   sonde de démarrage accorde une fenêtre d'environ 10 minutes :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/v1/health"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, Appsmith vous invite
   à créer le compte administrateur de l'instance — saisissez votre nom, votre e-mail et un
   mot de passe, puis inscrivez-vous. Aucun identifiant administrateur pré-renseigné n'existe dans Secret
   Manager : les trois secrets générés automatiquement protègent le chiffrement au repos
   (`APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT`) et le
   panneau superviseur interne (`APPSMITH_SUPERVISOR_PASSWORD`), et non la connexion à
   l'application. Le premier compte que vous créez devient l'administrateur de l'espace de travail.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — StatefulSet, pod et PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Ne dépassez pas un réplica.** `min_instance_count` et
   `max_instance_count` valent tous deux `1` par défaut et doivent le rester — le
   MongoDB intégré n'est pas en cluster, et chaque pod supplémentaire du StatefulSet
   provisionnerait son propre PVC **vide** et exécuterait une base de données divergente et non synchronisée,
   sans état partagé. `max_instance_count > 1` n'est pas bloqué au moment
   du plan ; l'augmenter est donc un véritable piège, et non un moyen pris en charge de monter en charge horizontalement.

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans la
   plateforme RAD et en l'appliquant via **Update**. Comme `container_image_source
   = "prebuilt"`, cela récupère simplement une autre étiquette `appsmith/appsmith-ce` depuis
   Docker Hub (de nouveau mise en miroir dans Artifact Registry) — aucun build personnalisé ni
   Dockerfile n'intervient, et une mise à jour progressive remplace l'unique pod.

4. **Gérez les secrets :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~appsmith"
   ```

   Ne faites jamais tourner `APPSMITH_ENCRYPTION_PASSWORD` ou `APPSMITH_ENCRYPTION_SALT`
   indépendamment d'une réinitialisation complète des données — ils chiffrent au repos les identifiants des sources de données
   et les clés SSH Git, et la modification de l'un ou l'autre rend les secrets
   enregistrés auparavant définitivement illisibles.

5. **Inspectez les données persistées** sur le PVC — les fichiers de données du MongoDB
   intégré, le dump Redis, les ressources téléversées et de plugins, ainsi que la configuration des applications connectées à Git
   se trouvent tous sous `/appsmith-stacks` :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- du -sh /appsmith-stacks
   kubectl exec -n "$NS" "$POD" -- env | grep APPSMITH
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'Explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU
   et de la mémoire des pods (le conteneur monolithique nécessite au moins 2 vCPU / 2Gi),
   le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner un **test de
   disponibilité** (uptime check) (lorsqu'il est activé) ; examinez Monitoring → Uptime checks et Alerting →
   Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Appsmith à l'autre.

- **Pod bloqué en `Pending` / non Ready pendant le démarrage :** c'est attendu pendant
  plusieurs minutes lors d'un démarrage à neuf — le conteneur monolithique démarre successivement le
  MongoDB intégré, Redis et le backend Java. La sonde de démarrage accorde
  une fenêtre d'environ 10 minutes (`initial_delay_seconds = 120`,
  `failure_threshold = 40`) avant d'abandonner ; ne concluez pas à un plantage avant que cette
  fenêtre ne soit écoulée.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from a crashed container, if any
  ```
- **CrashLoopBackOff après la fenêtre de démarrage :** recherchez un PVC corrompu ou
  sous-dimensionné (`stateful_pvc_size`), ou un secret `APPSMITH_ENCRYPTION_*`
  qui ne correspond plus aux données chiffrées persistées auparavant.
- **Problèmes de PVC / de stockage :** vérifiez que le PVC est `Bound` et non bloqué en
  `Pending` (le plus souvent un manque de quota SSD régional sur la StorageClass
  `standard-rwo` par défaut — dans ce cas, remplacez `stateful_pvc_storage_class` par
  `standard` (HDD)) :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
- **Montée en charge accidentelle à plusieurs réplicas :** si `max_instance_count` a été porté
  au-dessus de `1`, redescendez immédiatement et déterminez quel PVC de pod contient les
  données que vous souhaitez conserver — le PVC de l'autre pod est un MongoDB divergent, démarré à vide,
  et doit être considéré comme jetable, et non fusionné.
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` à la recherche de
  problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer dispose d'une
  IP attribuée.
- **Erreurs de récupération d'image :** vérifiez que l'image mise en miroir existe dans Artifact
  Registry (`enable_image_mirroring = true` évite les limites de débit de Docker Hub) et que
  le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment la règle essentielle de ne jamais modifier
`APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT` après le premier démarrage,
et de ne jamais porter `max_instance_count` au-dessus de `1`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (elle fait oublier le déploiement à RAD). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes,
l'espace de noms et le PersistentVolumeClaim (et avec lui toutes les données MongoDB/Redis
intégrées), les secrets Secret Manager et les images Artifact Registry mises en miroir.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le dépôt Artifact Registry,
les comptes de service partagés) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail StatefulSet GKE, un PVC de 20Gi, les secrets de chiffrement/superviseur, et met en miroir l'image préconstruite — pas de Cloud SQL, pas de tâche d'initialisation de base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; créer le compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter l'unique pod du StatefulSet, mettre à jour la version, gérer les secrets, inspecter les données persistées du PVC — ne pas dépasser 1 réplica |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Distinguer un démarrage lent d'un vrai CrashLoop, diagnostiquer les problèmes de PVC/quota et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
