---
title: "GlitchTip sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez GlitchTip sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/GlitchTip_GKE.md @ 3055034 sha256:468dc51aa6eb -->

# GlitchTip sur GKE Autopilot — Guide de lab {#glitchtip-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/GlitchTip_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–90 minutes

GlitchTip est une plateforme open source de suivi des erreurs et de surveillance des performances,
compatible avec Sentry. Vos applications envoient les exceptions et les traces à son point de
collecte, et GlitchTip les stocke, les regroupe et émet des alertes à leur sujet. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **GlitchTip sur GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis le
supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les
fonctionnalités du produit GlitchTip. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/GlitchTip_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder à la charge de travail en cours d’exécution, la vérifier et vous connecter en tant qu’administrateur créé d’office.
- Effectuer les opérations du jour 2 — inspecter les pods, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- **kubectl** installé.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **GlitchTip (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/GlitchTip_GKE) documente
   chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail GKE Autopilot (un Service LoadBalancer externe
   avec une IP statique réservée), une base de données Cloud SQL (PostgreSQL 15) avec ses secrets
   Secret Manager (`SECRET_KEY`, le mot de passe initial du superutilisateur et le mot de passe de la base), un
   bucket de données Cloud Storage et un stockage NFS pour les pièces jointes, construit l’image de conteneur
   personnalisée légère (`FROM glitchtip/glitchtip:6.2.0`), et exécute deux jobs ponctuels — `db-init`
   (base de données/utilisateur) puis `glitchtip-migrate` (migrations Django + création du superutilisateur).
   Un premier déploiement prend environ **20 à 35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Une fois le déploiement terminé, connectez-vous au cluster et repérez les ressources :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region "$REGION" --project "$PROJECT"
   NAMESPACE=$(kubectl get ns -o name | grep glitchtip | head -1 | cut -d/ -f2)
   echo "Namespace: $NAMESPACE"
   kubectl get pods,svc,hpa,pdb -n "$NAMESPACE"
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $SERVICE_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en bonne santé. GlitchTip expose un point de contrôle de santé sans
   authentification qui renvoie 200 dès que le serveur est démarré et que PostgreSQL est joignable :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://$SERVICE_IP/_health/"   # expect 200
   ```

2. Récupérez le mot de passe de l’administrateur créé d’office (le job `glitchtip-migrate` a créé
   `admin@techequity.cloud` à partir de ce secret) :

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

3. Ouvrez l’URL du service (ou le domaine personnalisé, s’il est configuré) dans un navigateur et connectez-vous en tant que
   `admin@techequity.cloud`. Créez votre première organisation et votre premier projet, puis copiez le
   DSN du projet pour faire pointer le SDK Sentry d’une application vers GlitchTip.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter les pods, le HPA et le PodDisruptionBudget :**

   ```bash
   kubectl get pods,hpa,pdb -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$NAMESPACE" --tail=100 2>/dev/null || \
     kubectl logs -n "$NAMESPACE" -l app --tail=100
   ```

2. **Mettre à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances puis en cliquant sur **Update** — le module
   est propriétaire de la spécification de la charge de travail, la mise à l’échelle est donc une modification de configuration, et non une modification manuelle via `kubectl`
   (une modification manuelle serait annulée à l’application suivante). Conservez `min_instance_count ≥ 1` :
   GKE ne prend pas en charge la mise à l’échelle à zéro, et le worker/beat Celery exécuté dans le même processus doit continuer
   de tourner.

3. **Mettre à jour la version de l’application** en modifiant le paramètre de version et en l’appliquant via
   **Update** ; une nouvelle image est construite, les migrations s’exécutent au démarrage et le Deployment est déployé progressivement.
   Comme NFS est activé, le déploiement utilise la stratégie `Recreate` (un pod à la fois sur
   le volume partagé).

4. **Gérer les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~glitchtip"
   kubectl get jobs,cronjobs -n "$NAMESPACE"
   ```

5. **Ouvrir une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. glitchtipdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^glitchtip" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^glitchtip" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project "$PROJECT" --limit 50
   ```

2. **Surveillance** — ouvrez le tableau de bord de la charge de travail GKE et examinez le nombre de pods, l’utilisation du processeur et de la
   mémoire par rapport aux requêtes de ressources, ainsi que le nombre de redémarrages. Consultez le test de disponibilité éventuellement provisionné dans
   Monitoring → Uptime checks, ainsi que Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de GlitchTip.

- **Pods non Ready / CrashLoopBackOff :** décrivez le pod et lisez ses journaux. La sonde de
  démarrage cible `/` (le chemin `startup_probe` par défaut du module) et accorde plusieurs minutes
  au premier démarrage pendant l’exécution des migrations.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>
  kubectl logs -n "$NAMESPACE" <pod> --previous
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE` et que le
  sidecar Cloud SQL Auth Proxy est en cours d’exécution. Sur GKE, le point d’entrée voit `DB_HOST = 127.0.0.1`
  (l’interface de bouclage du proxy) et se connecte en TCP sans SSL.
- **Le job de migration / de superutilisateur a échoué :** examinez le Job :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<glitchtip-migrate-job>
  ```
- **Pods bloqués au montage NFS :** vérifiez que le tag réseau `nfsserver` est présent (par défaut) et
  que la VM du serveur NFS partagé est `RUNNING`.
- **Déploiement bloqué lors d’une mise à jour :** avec NFS activé, la stratégie est `Recreate` ; l’ancien pod
  doit s’arrêter avant que le nouveau ne démarre. Vérifiez avec `kubectl rollout status`.
- **Le build de l’image a échoué :** consultez l’historique Cloud Build pour lire le journal du build en échec.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment les valeurs de ResourceQuota en unités binaires et le fait de ne jamais renommer le nom/l’utilisateur de la base).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est
conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le
gérer, utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans**
détruire les ressources cloud. La suppression retire tout ce que le module a créé — la charge de travail
GKE et son Service, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud
SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne la charge de travail GKE, Cloud SQL (PostgreSQL 15), des secrets, du stockage/NFS, et exécute `db-init` + `glitchtip-migrate` |
| 2 — Accéder et vérifier | Manuel | `/_health/` renvoie 200 ; connexion en tant que `admin@techequity.cloud`, créé d’office |
| 3 — Exploiter | Manuel | Inspecter pods/HPA/PDB, mettre à l’échelle, mettre à jour la version, gérer secrets/sauvegardes, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job de migration, de NFS, de déploiement et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
