---
title: "Tandoor sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Tandoor sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Tandoor_GKE.md @ 3055034 sha256:124b9cb9ac1e -->

# Tandoor sur GKE Autopilot — Guide de lab {#tandoor-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Tandoor_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Tandoor Recipes est un gestionnaire de recettes et planificateur de repas open
source et auto-hébergé, capable d'importer des recettes depuis une URL. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **Tandoor on GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les fonctionnalités de Tandoor. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Tandoor_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et récupérer l'identifiant du superutilisateur généré.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez
  pas besoin de le déployer vous-même au préalable — la plateforme détecte
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Tandoor
   (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Tandoor_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du
   déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses secrets
   Secret Manager (`SECRET_KEY`, `DJANGO_SUPERUSER_PASSWORD` et le mot de passe
   de la base de données), un bucket Cloud Storage `data`, et exécute deux jobs
   ponctuels : `db-init` (crée la base de données et l'utilisateur) et
   `create-superuser` (initialise le compte administrateur). Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL
   en représente l'essentiel).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres
   indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep tandoor | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s'exécute et repérez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est opérationnel. Tandoor n'a pas de point de
   terminaison de santé dédié non authentifié ; vérifiez donc la page de
   connexion publique de Django :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/accounts/login/"   # expect 200
   ```

3. Récupérez l'identifiant du superutilisateur généré — Tandoor n'a **ni
   parcours d'auto-inscription ni identifiant par défaut fixe** :

   ```bash
   SECRET_NAME=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~tandoor-superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}/accounts/login/` dans un navigateur et
   connectez-vous avec le nom d'utilisateur `admin` (ou la valeur de
   `admin_username` que vous avez configurée) et le mot de passe récupéré
   ci-dessus.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et
   l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal
   d'instances puis en cliquant sur **Update** sur la page de détails du
   déploiement — le module possède la spécification de la charge de travail,
   la mise à l'échelle est donc une modification de configuration et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la
   prochaine application). Tandoor n'a pas de worker en arrière-plan ; une mise
   à l'échelle au-delà d'une réplique ne requiert donc aucune coordination
   particulière.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de
   version dans la plateforme RAD et en l'appliquant via **Update** ; une mise
   à jour progressive remplace les pods. Tandoor publie en amont un véritable
   tag `latest`.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~tandoor"
   kubectl get jobs -n "$NS"          # db-init and create-superuser
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la
   maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. tandoordemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^tandoor" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez
   l'utilisation CPU et mémoire des pods, le nombre de redémarrages et les
   métriques de requêtes. Le module peut provisionner un **contrôle de
   disponibilité** (uptime check, lorsqu'il est activé) ; consultez
   Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Tandoor.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les
  journaux. La sonde de démarrage cible `/accounts/login/` et exige une
  connectivité à Postgres ainsi que des migrations appliquées pour renvoyer
  200 ; un échec de connexion à PostgreSQL empêchera le pod de devenir prêt.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud
  SQL est `RUNNABLE`, que le secret du mot de passe de la base de données a
  bien été matérialisé dans le namespace et que le job `db-init` s'est terminé.
- **Connexion impossible / aucun identifiant connu :** récupérez
  `DJANGO_SUPERUSER_PASSWORD` depuis Secret Manager (tâche 2, étape 3) — il
  n'existe aucun identifiant de secours fixe.
- **Échec du job `create-superuser` :** inspectez le job et les journaux de son
  pod — une cause fréquente est une course entre ce job et `db-init`
  (`execute_on_apply` de GKE détermine uniquement si Terraform attend, et non
  si le pod est planifié avant la fin de `db-init` ; le job réessaie jusqu'à
  deux fois) :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<create-superuser-job-name>
  ```
- **Pod en attente / aucune IP externe :** consultez les événements de
  `kubectl describe pod` à la recherche de problèmes de ressources ou de quota,
  et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans
  Artifact Registry et que le compte de service des nœuds peut la récupérer
  (Tandoor est préconstruit par défaut ; cela ne s'applique donc que si
  `container_image_source` a été remplacé par `custom`).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour
les pièges propres à chaque paramètre (dont la règle essentielle de ne jamais
effectuer de rotation de `SECRET_KEY` après le premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône
**Trash** (**Delete**). La suppression exécute `terraform destroy` et est
irréversible (l'enregistrement du déploiement est conservé pour l'historique).
Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer
(par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud
(RAD oublie simplement le déploiement). La suppression retire tout ce que le
module a créé — la charge de travail Kubernetes et son namespace, la base de
données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le
cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne
sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets et le bucket de stockage, et exécute `db-init` + `create-superuser` |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; récupérer l'identifiant du superutilisateur généré et se connecter |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
