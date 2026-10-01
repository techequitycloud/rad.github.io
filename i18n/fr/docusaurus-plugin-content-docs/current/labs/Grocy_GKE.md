---
title: "Grocy sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Grocy sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Grocy_GKE.md @ 3055034 sha256:b9ff1108c356 -->

# Grocy sur GKE Autopilot — Guide de lab {#grocy-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Grocy_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–75 minutes

Grocy est un ERP auto-hébergé pour les courses et le foyer — suivi des stocks avec
lecture de codes-barres, gestion des corvées et des tâches, listes de courses et planification des repas. Ce
lab vous guide à travers le cycle de vie opérationnel complet du module **Grocy on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Grocy. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Grocy_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Accéder au StatefulSet en cours d'exécution et le vérifier, notamment en vous connectant avec les
  identifiants par défaut et en les modifiant.
- Vérifier que le PVC de stockage en mode bloc sur `/config` est lié et réellement accessible en écriture.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet, mettre à jour la version et
  gérer le PVC persistant.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le
  déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Grocy (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Grocy_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne un **StatefulSet** (et non un simple Deployment — Grocy
   a besoin d'un stockage stable par pod), un PVC de stockage en mode bloc par pod (`standard-rwo`,
   20Gi par défaut) monté sur `/config`, et réplique l'image de conteneur Grocy
   dans Artifact Registry. Il n'y a aucune base de données à provisionner (Grocy utilise une
   base de données SQLite intégrée) ni de job d'initialisation par défaut. Un premier déploiement
   prend généralement **10–20 minutes**.

3. Une fois terminé, repérez les ressources avec des filtres indépendants du nom (afin que les
   commandes fonctionnent quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep grocy | head -1 | cut -d/ -f2)
   POD=$(kubectl get pods -n "$NAMESPACE" -l app="$SERVICE" -o jsonpath='{.items[0].metadata.name}')
   echo "Service: $SERVICE"
   echo "Pod:     $POD"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est en bonne santé — `1/1 Running` avec **0 redémarrage**, conformément à ce
   qui a été constaté lors du déploiement réel :

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect 1/1 Running, 0 restarts
   kubectl get pvc -n "$NAMESPACE"                        # expect Bound
   ```

2. Grocy n'a pas de point de terminaison de santé dédié — la page de connexion elle-même (`200`,
   non authentifiée) sert de cible aux sondes. Si votre Service est de type `ClusterIP` (la valeur
   par défaut de ce déploiement, selon `config/deploy.tfvars`), accédez-y via
   `port-forward` :

   ```bash
   kubectl port-forward -n "$NAMESPACE" svc/"$SERVICE" 18080:80 &
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -L "http://localhost:18080/"
   # expect: 200 <nonzero size>
   curl -s -L "http://localhost:18080/" | grep -o '<title>[^<]*</title>'
   # expect: <title>Login | Grocy</title>
   ```

   Ou vérifiez directement depuis l'intérieur du pod :

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- curl -s -o /dev/null -w '%{http_code}\n' -L http://localhost:80/
   ```

3. Ouvrez l'URL du service (via `port-forward`, ou l'IP du LoadBalancer si vous avez
   déployé avec `service_type = "LoadBalancer"`) dans un navigateur. Connectez-vous avec
   les identifiants par défaut intégrés à Grocy — **`admin` / `admin`** — il n'y a aucun
   identifiant pré-initialisé à rechercher dans Secret Manager ; l'image amont est livrée
   directement avec cette valeur par défaut.

4. **Changez immédiatement le mot de passe administrateur.** Allez dans le menu utilisateur → **Manage
   users** → modifiez `admin` → définissez un nouveau mot de passe. Si le module est exposé
   à l'extérieur (`service_type = "LoadBalancer"`), laisser les identifiants par défaut
   en place sur un déploiement en production constitue une véritable exposition.

5. Ajoutez un élément réel — par exemple un produit sous **Master data → Products**, ou une
   corvée sous **Chores** — et vérifiez qu'il apparaît dans la vue de liste correspondante.
   Il s'agit de l'écriture avec état qui prouve que le PVC en mode bloc `/config` est réellement
   accessible en écriture et durable, et pas seulement que la page de connexion s'est affichée.

6. **Vérifiez que le PVC en mode bloc est réellement accessible en écriture** (le même fait que le journal de démarrage
   a déjà démontré via la génération de clés TLS sous `/config/keys`) :

   ```bash
   kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /config
   # expect: grocy.db, config.php, keys/, data/ — all owned by uid 1000
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le StatefulSet et son historique de déploiement :**

   ```bash
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status statefulset/"$SERVICE" -n "$NAMESPACE"
   kubectl describe statefulset "$SERVICE" -n "$NAMESPACE"
   ```

2. **La mise à l'échelle est volontairement verrouillée à une instance.** Contrairement à la plupart des modules de
   ce catalogue, n'augmentez pas `max_instance_count` au-delà de `1` — la base de données SQLite
   intégrée de Grocy n'accepte qu'un seul rédacteur et ne prend pas en charge le clustering ; de plus,
   comme le StatefulSet utilise des `volumeClaimTemplates`, un second réplica obtiendrait
   son propre PVC déconnecté au lieu de partager `/config`.

3. **Mettez à jour le tag de version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite (fixée
   via l'ARG de build `GROCY_VERSION`, et non via le générique `APP_VERSION`) et le
   StatefulSet effectue une mise à jour progressive. Le PVC `/config` n'est pas affecté par une
   mise à jour de l'image — c'est tout l'intérêt du stockage stable par pod d'un StatefulSet.

4. **Inspectez le PVC persistant `/config` :**

   ```bash
   kubectl get pvc -n "$NAMESPACE"
   kubectl describe pvc <pvc-name> -n "$NAMESPACE"
   ```

5. **Sauvegardez `/config` manuellement si nécessaire** — ce module ne comporte aucun job de sauvegarde automatisé
   propre à Grocy ; utilisez les paramètres génériques de la plateforme
   `backup_schedule` / `enable_backup_import`, ou créez directement un instantané du
   Persistent Disk sous-jacent via la Console (Compute Engine → Disks).

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NAMESPACE" "$POD" --tail=100
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

   Un démarrage propre montre la séquence de démarrage s6-overlay/LinuxServer se terminant
   par `[ls.io-init] done.`, sans erreur d'autorisation autour de `/config`.

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads du StatefulSet et
   examinez l'utilisation du CPU et de la mémoire ainsi que le nombre de réplicas (qui doit rester exactement à `1`).
   Le module peut provisionner un **test de disponibilité** (lorsque
   `uptime_check_config.enabled = true` — la valeur par défaut est `false`) ; s'il est activé,
   vérifiez qu'il est au vert dans Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Grocy.

- **Pod bloqué en `Pending` — le PVC ne se lie pas.** Vérifiez que la StorageClass existe et
  que le quota régional SSD/Balanced-PD n'est pas épuisé :
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc <pvc-name> -n "$NAMESPACE"
  ```
- **Pod en `CrashLoopBackOff` avec des erreurs d'autorisation sur `/config`.** Cela
  indiquerait une incohérence de `stateful_fs_group` avec l'UID/GID de Grocy (1000/1000) —
  la valeur par défaut du module (`1000`) correspond déjà, mais vérifiez si elle a été remplacée :
  ```bash
  kubectl describe pod -n "$NAMESPACE" "$POD"
  kubectl logs -n "$NAMESPACE" "$POD" --tail=200
  ```
- **Révision en mauvaise santé / le Service ne répond pas :** inspectez le pod et ses journaux
  à la recherche d'erreurs de démarrage, et vérifiez que le PVC s'est correctement attaché.
  ```bash
  kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" "$POD" --tail=100
  ```
- **La page de connexion se charge, mais les données ne persistent pas après le redémarrage d'un pod :** cela
  indique que le PVC n'est pas réellement lié/monté correctement — revérifiez
  `kubectl get pvc` et les `volumeClaimTemplates` du StatefulSet plutôt que de
  supposer un bogue de l'application.
- **Échecs de build lors du déploiement ou de la mise à jour de version :** consultez l'historique Cloud Build
  pour le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez la liaison Workload Identity du pod et
  ses rôles IAM.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme
RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit
avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement
des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie
le déploiement). La suppression retire tout ce que le module a créé — le
StatefulSet, le Service Kubernetes, le PVC de stockage en mode bloc (et le Persistent Disk
sous-jacent), le bucket Cloud Storage `storage` et les images Artifact Registry.
Les ressources détenues par **Services_GCP** (le VPC, le cluster GKE, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le StatefulSet, un PVC de stockage en mode bloc sur `/config`, et réplique l'image du conteneur |
| 2 — Accéder et vérifier | Manuel | Pod `1/1 Running`, 0 redémarrage ; PVC Bound ; le test de santé réussit ; se connecter avec `admin`/`admin`, changer le mot de passe, écrire un élément réel |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet, mettre à jour la version, vérifier que la mise à l'échelle reste à 1, inspecter/sauvegarder le PVC |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de liaison du PVC, d'autorisation, de StatefulSet et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le PVC et son disque sous-jacent |
