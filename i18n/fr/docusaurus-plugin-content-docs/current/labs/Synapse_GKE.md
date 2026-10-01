---
title: "Synapse sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Synapse sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Synapse_GKE.md @ 3055034 sha256:0d886cd3b375 -->

# Synapse sur GKE Autopilot — Guide de lab {#synapse-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Synapse est le homeserver [Matrix](https://matrix.org/) de référence — le serveur
open source de Matrix, un standard ouvert de communication en temps réel décentralisée
et fédérée. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**Synapse on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
enregistrer un administrateur et vous connecter via l'API Matrix, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités de Matrix. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Enregistrer un utilisateur administrateur et vous connecter via l'API client Matrix ; connecter Element.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Un **domaine que vous contrôlez** pour `server_name` si vous comptez fédérer (définissez-le avant
  le premier déploiement — il est immuable).

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Synapse (GKE)** dans la liste **Platform
   Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et — point important — définissez **`server_name`** sur votre
   domaine réel (il est intégré à chaque identifiant d'utilisateur et est immuable après le premier démarrage).
   Passez en revue les autres paramètres ; le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Synapse_GKE) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en
   temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une base de données Cloud
   SQL (PostgreSQL 15) avec ses secrets Secret Manager (le secret partagé d'enregistrement
   et le mot de passe de la base), un bucket de données Cloud Storage et un volume NFS pour la
   clé de signature et les médias, construit l'image de conteneur et exécute un job ponctuel `db-init`
   qui crée la base de données **avec la collation `C` obligatoire**. Il n'y a pas de job de
   migration distinct — Synapse construit son propre schéma au premier démarrage. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep synapse | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier ; enregistrer un administrateur [Manuel] {#task-2--access--verify-register-an-admin-manual}

1. Vérifiez que la charge de travail s'exécute et repérez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le homeserver est opérationnel. Synapse renvoie un `200 OK` non authentifié sur
   `/health` sur le port 8008, et l'API client Matrix annonce les versions de la spécification
   qu'elle prend en charge :

   ```bash
   curl -s "http://${EXTERNAL_IP}/health"                    # expect: OK
   curl -s "http://${EXTERNAL_IP}/_matrix/client/versions"   # expect JSON with a "versions" array
   ```

3. **Le premier utilisateur administrateur est déjà enregistré.** Le job d'initialisation `create-admin`
   du module exécute `register_new_matrix_user -u admin -a` pour vous, en utilisant le
   mot de passe superutilisateur généré conservé dans Secret Manager. Lisez ce mot de passe :

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~synapse AND name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

   L'inscription libre en libre-service est désactivée par défaut ; créez donc les utilisateurs *supplémentaires*
   hors bande avec `register_new_matrix_user`, exécuté depuis l'intérieur du pod où
   `homeserver.yaml` (avec son secret partagé) est présent :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- \
     register_new_matrix_user -c /data/homeserver.yaml -u <new-user> -p '<strong-password>' \
     http://localhost:8008
   ```

4. **Connectez-vous via l'API Matrix** pour vérifier que le compte fonctionne de bout en bout :

   ```bash
   curl -s -XPOST "http://${EXTERNAL_IP}/_matrix/client/v3/login" \
     -H 'Content-Type: application/json' \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"admin"},"password":"<the-password>"}'
   # A successful response returns an access_token, device_id, and user_id (@admin:<server_name>).
   ```

5. **Connectez un client.** Ouvrez l'application web [Element](https://app.element.io/), choisissez
   *Sign in* → *Edit* pour le homeserver, et saisissez l'URL de votre homeserver (l'IP externe ou,
   de préférence, un domaine personnalisé correspondant à `server_name`). Connectez-vous en tant que `admin`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa,pdb,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Conservez au moins une réplique.** GKE ne réduit pas à zéro, ce qui convient à un homeserver
   fédéré qui doit rester joignable ; `min_instance_count = 1` et un PodDisruptionBudget
   le maintiennent disponible pendant les mises à niveau des nœuds. La mise à l'échelle est une modification de configuration via
   **Update**, et non un `kubectl scale` manuel (une modification manuelle est annulée lors de la prochaine
   application). L'affinité de session (`ClientIP`) maintient les requêtes d'un client sur le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace les
   pods (les charges de travail adossées à NFS utilisent une stratégie `Recreate` pour éviter que deux pods se disputent
   le même répertoire de données). Synapse applique lui-même les mises à niveau de schéma au démarrage.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~synapse"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance — et vérifiez la
   collation :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. synapsedemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^synapse" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'synapse';
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et mémoire
   des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner un
   **contrôle de disponibilité** (uptime check, lorsqu'il est activé — `uptime_check_config` vaut par défaut
   `enabled = false`) sur `/`, et non `/health` ; consultez Monitoring → Uptime checks
   et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Synapse.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. `startup_probe` et
  `liveness_probe` ciblent par défaut le chemin `/` (cette variante GKE remplace la valeur par défaut
  `/health` propre à `Synapse_Common`) et la sonde de disponibilité (readiness) cible `/health`, toutes sur le port **8008** — une
  incohérence du port du conteneur ou du port de sonde fait que la sonde
  frappe un port mort et le pod ne devient jamais Ready alors que Synapse est en bonne santé.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events show scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`Database has incorrect values for … collation` :** la base de données n'a pas été créée avec
  la collation `C`. Vérifiez que le job `db-init` s'est exécuté ; relancez-le ou recréez la base de données (vide)
  avec `LC_COLLATE='C' LC_CTYPE='C'`.
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job>
  ```
- **Fédération rompue / sessions d'appareils perdues après un redéploiement :** la clé de signature a été
  régénérée parce que le répertoire de données n'était pas persistant. Utilisez soit un PVC de StatefulSet
  (`stateful_pvc_mount_path` vaut déjà `/data` par défaut), soit conservez `enable_nfs = true`
  (la valeur par défaut) **et définissez `nfs_mount_path = "/data"`** — sa valeur par défaut est
  `/opt/synapse/storage`, qui ne correspond pas au répertoire de données du point d'entrée
  (`SYNAPSE_DATA_DIR = "/data"`), de sorte que la clé de signature n'arriverait pas sur le montage
  persistant et ne survivrait pas aux redémarrages de pods.
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret du
  mot de passe de la base a bien été matérialisé dans le namespace et que le job d'initialisation s'est terminé.
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes de ressources ou
  de quota, et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment les règles essentielles selon lesquelles `server_name` et la clé de signature sont
immuables après le premier démarrage, et selon lesquelles le port du conteneur et les sondes doivent être sur 8008).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus
le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt
**Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire
les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module
a créé — la charge de travail Kubernetes et son namespace, la base de données Cloud SQL, les secrets Secret Manager,
les buckets GCS, le volume NFS et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées
séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15, collation C), les secrets et le stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; enregistrer un administrateur ; se connecter via l'API Matrix ; connecter Element |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer secrets/stockage, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de collation, de clé de signature, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
