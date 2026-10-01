---
title: "DocuSeal sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez DocuSeal sur GKE Autopilot dans votre propre projet Google Cloud — installation guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Docuseal_GKE.md @ 3055034 sha256:4239bf7c09ba -->

# DocuSeal sur GKE Autopilot — Guide de lab {#docuseal-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Docuseal_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

DocuSeal est une plateforme open source de signature électronique de documents — une alternative auto-hébergée
à DocuSign construite sur Ruby on Rails, avec un concepteur visuel de formulaires, des modèles réutilisables et
des pistes d'audit, adossée à PostgreSQL. Ce lab vous fait parcourir l'intégralité du cycle de vie
opérationnel du module **DocuSeal on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités du produit DocuSeal. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Docuseal_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **DocuSeal (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Docuseal_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, par exemple la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`SECRET_KEY_BASE` et le mot de passe de la base de données), un bucket Cloud Storage, monte le
   volume NFS partagé sur `/data/docuseal` pour les documents persistants (le modèle de
   persistance par défaut), construit l'image de conteneur et exécute un job unique
   d'initialisation de la base de données (qui crée le rôle et la base de données `docuseal`). Les premiers
   déploiements prennent environ **20–35 minutes** (la création de Cloud SQL en représente l'essentiel).

3. Connectez-vous au cluster et découvrez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep docuseal | head -1 | cut -d/ -f2)
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
   ```

2. Vérifiez que le service est en bonne santé. DocuSeal expose le point de terminaison de santé intégré `/up` de Rails,
   qui renvoie un `200` sans authentification une fois que Puma a démarré et que
   PostgreSQL est joignable via le sidecar Cloud SQL Auth Proxy :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/up"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. DocuSeal est livré sans identifiants
   par défaut — remplissez l'écran de configuration pour créer le compte administrateur initial
   (e-mail + mot de passe) avant d'inviter des utilisateurs ou de créer des modèles.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le deployment (ou le statefulset, si un PVC de type bloc est
   activé), les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max puis en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification de la charge de travail, la mise à l'échelle est donc un changement de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de l'application suivante). GKE
   exige au moins 1 réplica (pas de mise à l'échelle jusqu'à zéro). `session_affinity` (`ClientIP`)
   est défini par défaut pour router les sessions de signature en plusieurs étapes vers le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace les
   pods. DocuSeal exécute automatiquement ses propres migrations ActiveRecord à chaque démarrage, de sorte
   qu'un changement de version applique les modifications de schéma sans étape de migration distincte — épinglez
   `application_version` en production afin qu'une récupération non vérifiée de `latest` n'applique pas
   de migrations inattendues.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~docuseal"
   kubectl get jobs -n "$NS"          # db-init job
   kubectl get pvc -n "$NS"          # only present if stateful_pvc_enabled = true
   ```

5. **Inspectez les documents persistants** — DocuSeal écrit les téléversements dans `/data/docuseal` sur
   le volume NFS (ou le PVC de type bloc) :

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" -- df -h /data/docuseal
   ```

6. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. docusealdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^docuseal" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^docuseal" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer (Rails écrit ses journaux sur stdout) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods (le rendu et la signature de PDF sont gourmands en mémoire), le nombre de redémarrages et
   les métriques de requêtes. Le module peut provisionner un **uptime check** (désactivé par
   défaut) ; lorsqu'il est activé, examinez Monitoring → Uptime checks et Alerting →
   Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de DocuSeal.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de démarrage et
  de vivacité ciblent `/up` sur le port 3000 — si `container_port` ou les ports des sondes
  ont été modifiés pour ne plus valoir 3000, elles frappent un port inactif (GKE n'injecte pas `PORT`
  comme le fait Cloud Run) et le pod ne devient jamais Ready alors même que l'application est
  en bonne santé.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que
  `enable_cloudsql_volume` vaut `true` (le sidecar Auth Proxy fournit au point d'entrée le chemin
  loopback `127.0.0.1` qu'il attend), et que le job d'initialisation s'est terminé.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Documents manquants après un redémarrage du pod :** vérifiez qu'exactement l'un des paramètres `enable_nfs` ou
  `stateful_pvc_enabled` est défini — sans aucun des deux, les téléversements atterrissent sur le disque éphémère
  du pod et sont perdus au redémarrage ou lors d'une replanification.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour détecter des problèmes
  de ressources ou de quotas, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte
  de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la règle essentielle de ne jamais faire tourner `SECRET_KEY_BASE` après le premier
démarrage, et de laisser `nfs_mount_path`/`stateful_pvc_mount_path` définis sur `/data/docuseal`).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, la base de données Cloud SQL, les secrets Secret Manager, le bucket GCS et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), des secrets, un bucket de stockage, un montage NFS, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé `/up` répond ; création du compte administrateur initial dans l'interface |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage/les documents, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et l'uptime check |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de stockage, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
