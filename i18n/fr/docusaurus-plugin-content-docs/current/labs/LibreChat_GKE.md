---
title: "LibreChat sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez LibreChat sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/LibreChat_GKE.md @ 3055034 sha256:db783bca4935 -->

# LibreChat sur GKE Autopilot — Guide de lab {#librechat-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LibreChat_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

LibreChat est une interface de chat IA open source qui offre une expérience unifiée sur plus de 20
fournisseurs de LLM, dont OpenAI, Anthropic, Google Gemini et Ollama. Ce lab vous fait parcourir
tout le cycle de vie opérationnel du module **LibreChat on GKE Autopilot** sur
Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités de LibreChat. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LibreChat_GKE) — ce
lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **LibreChat (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LibreChat_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, copie l'image de conteneur
   LibreChat vers Artifact Registry, injecte un service sidecar MongoDB dans l'espace de noms
   (lorsqu'aucun `mongodb_uri` externe n'est fourni), génère des secrets cryptographiques dans Secret
   Manager et provisionne un bucket GCS pour les téléversements. Les premiers déploiements prennent environ **20 à 35
   minutes** (le provisionnement des nœuds GKE Autopilot et la copie de l'image représentent l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep librechat | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/"
   # expect 200
   ```

   Le chemin racine de LibreChat (`/`) renvoie HTTP 200 une fois l'application entièrement initialisée
   et connectée à MongoDB. Si vous recevez une réponse différente de 200, les pods sont peut-être encore
   en cours de démarrage — attendez que tous les pods atteignent `Running 1/1` avant de poursuivre le diagnostic.

2. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. La page de connexion et d'inscription de LibreChat
   s'affiche. Inscrivez le compte administrateur initial. Après l'inscription, revenez sur la
   plateforme RAD, définissez `allow_registration = false`, puis appliquez la modification via **Update** pour empêcher les
   inscriptions non autorisées en libre-service sur les déploiements publics.

3. Vérifiez que les secrets applicatifs générés automatiquement sont en place :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"
   ```

   Vous devriez voir des secrets pour `creds-key`, `creds-iv`, `jwt-secret`, `jwt-refresh-secret`
   et `mongo-uri`. Ils sont injectés à l'exécution via le pilote Secret Store CSI — ils
   n'apparaissent jamais en clair dans les spécifications des pods.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes, les pods et (s'ils sont activés) l'autoscaler horizontal
   et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement — le
   module possède la spécification de la charge de travail, donc la mise à l'échelle est une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application). Activez Redis lorsque
   vous exécutez plus d'un réplica afin de maintenir la cohérence des sessions entre les pods.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image est copiée et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"

   # Inspect the GCS uploads bucket
   UPLOADS_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~librechat" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${UPLOADS_BUCKET}/"

   kubectl get jobs -n "$NS"          # any custom initialization jobs
   ```

5. **Injectez les clés d'API des fournisseurs d'IA** à l'aide de `secret_environment_variables` (et non de
   `environment_variables` en clair) afin qu'elles ne soient jamais exposées dans les spécifications des pods ni dans les journaux d'audit. Créez
   d'abord les secrets dans Secret Manager, puis référencez-les par leur nom dans la plateforme RAD et
   appliquez la modification via **Update**.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module provisionne également un
   **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LibreChat.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à MongoDB :** vérifiez que le service sidecar MongoDB de l'espace de noms est
  en cours d'exécution (ou que le `mongodb_uri` externe est joignable), et que le secret `mongo-uri`
  possède une version valide matérialisée dans l'espace de noms.
  ```bash
  kubectl get svc -n "$NS" | grep mongo
  gcloud secrets list --project="$PROJECT" --filter="name~librechat AND name~mongo-uri"
  ```
- **Échecs de la sonde de démarrage :** les démarrages à froid de LibreChat peuvent prendre 15 à 30 secondes, le temps que la
  connexion MongoDB s'établisse et que les ressources se chargent. La sonde de démarrage dispose d'un seuil d'échec
  généreux — vérifiez avec `kubectl describe pod` que la sonde comptabilise les
  échecs sans avoir encore dépassé le seuil avant de poursuivre le diagnostic.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes
  de ressources ou de quota, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes et
l'espace de noms (y compris le service auxiliaire MongoDB de l'espace de noms, qui constitue le backend de base de données
par défaut), les secrets Secret Manager, le bucket GCS des téléversements, le volume NFS et les images d'Artifact Registry.
Si vous aviez plutôt remplacé `mongodb_uri` pour activer la compatibilité MongoDB de Firestore, cette
**base de données Firestore est volontairement conservée** (politique ABANDON) afin d'éviter toute perte de données ; supprimez-la
manuellement via la console GCP si vous n'en avez plus besoin — cela ne s'applique pas à un déploiement
par défaut, puisqu'aucune base de données Firestore n'a été créée. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le registre partagé) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, le sidecar MongoDB, les secrets et le bucket GCS des téléversements |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle d'état réussit ; inscrire le compte administrateur initial |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de MongoDB, de sonde de démarrage, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris le sidecar MongoDB par défaut ; la base de données Firestore (si activée) est conservée |
