---
title: "LubeLogger sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez LubeLogger sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/LubeLogger_GKE.md @ 3055034 sha256:a7f7352c98b5 -->

# LubeLogger sur GKE Autopilot — Guide de lab {#lubelogger-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/LubeLogger_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 60 minutes

LubeLogger est un outil gratuit et open source de suivi de l'entretien des véhicules et de la consommation de carburant
(ASP.NET Core, base de données LiteDB embarquée). Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **LubeLogger on GKE Autopilot** sur Google
Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit LubeLogger. Pour la liste complète des services provisionnés et de
chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/LubeLogger_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, y compris le
  flux d'inscription en libre-service au premier démarrage.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet et le PVC, comprendre la
  contrainte d'instance unique, mettre à jour et gérer le stockage.
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

1. Dans la navigation supérieure de la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, ouvrez **LubeLogger (GKE)**
   dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/LubeLogger_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme déploie LubeLogger sous forme de **StatefulSet** dans le cluster GKE Autopilot
   avec un PVC bloc par pod monté sur `/App/data` (`stateful_pvc_enabled = true`
   par défaut), un petit bucket Cloud Storage (`dpkeys`) pour les clés ASP.NET Core Data
   Protection, et met en miroir l'image officielle préconstruite dans Artifact Registry.
   Il n'y a ni instance Cloud SQL ni job d'initialisation de la base de données, les premiers
   déploiements sont donc relativement rapides — généralement **10 à 15 minutes** (principalement consacrées au provisionnement
   du PVC et à la planification dans le cluster).

3. Connectez-vous au cluster et repérez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep lubelogger | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. LubeLogger expose sa page publique et non authentifiée
   `/Login` — le même chemin que celui utilisé par les sondes de santé de la plateforme :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/Login"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}/Login` dans un navigateur. Il n'y a **aucun identifiant administrateur
   préconfiguré** — cliquez sur **Register** et créez le premier compte (nom, adresse e-mail,
   mot de passe). Comme `EnableAuth = "true"` est activé par défaut, c'est le SEUL moyen
   d'obtenir l'accès ; la racine de l'application `/` redirige les visiteurs non authentifiés vers `/Login`.
   Effectuez cette étape immédiatement après le déploiement.

4. Une fois connecté, ajoutez un véhicule et un enregistrement d'entretien ou de carburant pour confirmer que le chemin
   d'écriture de la base de données (LiteDB embarquée, persistée sur le PVC bloc) fonctionne.
   Actualisez la page et confirmez que l'enregistrement est toujours présent.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, le pod et le PVC :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **La mise à l'échelle est volontairement figée à un réplica.** `min_instance_count = 1` et
   `max_instance_count = 1` sont imposés par une validation au moment du plan —
   le mode par défaut de LubeLogger sert un unique fichier de base de données embarqué partagé depuis un seul
   volume, si bien qu'exécuter plusieurs réplicas risque de le corrompre. Il n'existe aucun moyen pris en charge
   de mettre ce module à l'échelle horizontalement dans sa configuration par défaut.

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans la plateforme
   RAD et en l'appliquant via **Update** ; comme l'image est préconstruite (et non
   construite sur mesure), cela sélectionne directement l'étiquette de version
   `ghcr.io/hargata/lubelogger` correspondante et une mise à jour progressive remplace le pod.

4. **Inspectez le stockage :**

   ```bash
   kubectl get pvc -n "$NS"
   gcloud storage buckets list --project="$PROJECT" --filter="name~lubelogger"
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
   mémoire des pods ainsi que le nombre de redémarrages (attendez-vous à un pod unique stable, 0 redémarrage).
   Le module peut provisionner un **test de disponibilité** (lorsqu'il est activé) ; examinez
   Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de LubeLogger.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  cible `/Login` et devrait réussir dans les secondes qui suivent le démarrage du conteneur —
  il n'y a pas de migration de base de données à attendre au premier démarrage.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod bloqué à l'état Pending :** consultez les événements de `kubectl describe pod` pour détecter des problèmes de
  provisionnement du PVC ou de quota SSD/HDD (`stateful_pvc_storage_class`).
- **Les données ne persistent pas entre les redémarrages du pod :** confirmez que le PVC est lié et monté
  sur `/App/data` (`kubectl describe pod` → section Volumes/Mounts).
- **Déconnexion inattendue après un redéploiement :** confirmez que le bucket GCS `dpkeys`
  existe et qu'il est monté sur `/root/.aspnet/DataProtection-Keys` — s'il a déjà été
  supprimé puis recréé, toutes les sessions existantes sont invalidées (sans gravité, il suffit de
  se reconnecter).
- **`/` renvoie une redirection/401 au lieu de l'application :** comportement attendu lorsque
  `EnableAuth = "true"` et que vous n'êtes pas connecté. Accédez directement à `/Login`.
- **Pod en attente / pas d'IP externe :** confirmez que le Service LoadBalancer dispose d'une
  IP attribuée et que `service_type = "LoadBalancer"` (et non `ClusterIP`).
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la règle essentielle de conserver `max_instance_count = 1`).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, le PVC, le bucket Cloud Storage `dpkeys` et les images Artifact Registry
(**tous les enregistrements de véhicules et les documents téléversés sont perdus**). Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie le StatefulSet GKE avec un PVC bloc, un petit bucket Cloud Storage, et met en miroir l'image préconstruite (ni base de données, ni étape de build) |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; inscription du premier compte et confirmation qu'un enregistrement persiste |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet et le PVC, comprendre la contrainte de réplica unique figée, mettre à jour la version, inspecter le stockage |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, de session et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris toutes les données |
