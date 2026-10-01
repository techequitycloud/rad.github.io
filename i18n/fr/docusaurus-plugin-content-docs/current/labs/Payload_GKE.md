---
title: "Payload CMS sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Payload CMS sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Payload_GKE.md @ 3055034 sha256:2e257b3e0f3f -->

# Payload CMS sur GKE Autopilot — Guide de lab {#payload-cms-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Payload_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Payload CMS est un CMS headless et un framework applicatif natif TypeScript, orienté code, construit
directement sur Next.js. Contrairement à la plupart des modules de ce catalogue, il n'existe **aucune image Docker
officielle de Payload** — ce module construit à partir des sources une véritable application de démarrage vérifiée localement (un
modèle `create-payload-app` vierge utilisant l'adaptateur PostgreSQL). Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Payload on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les
fonctionnalités de modélisation de contenu propres à Payload. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Payload_GKE) — ce lab
ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder à la charge de travail en cours d'exécution et la vérifier, y compris en créant le premier compte administrateur Payload.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et les sauvegardes.
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
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une seule fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Payload (GKE)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres. Ne configurez
   que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Payload_GKE) documente chaque
   paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne la charge de travail GKE (Deployment + Service), une base de données Cloud SQL (PostgreSQL 15)
   avec ses secrets Secret Manager (`PAYLOAD_SECRET` et le mot de passe de la base de données),
   **construit l'application Payload à partir des sources via Cloud Build** (il n'existe aucune image préconstruite à
   récupérer), et exécute deux tâches séquentielles : `db-init` (crée le rôle et la base de données)
   puis `payload-migrate` (applique le schéma Payload — cette tâche nécessite l'intégralité des sources de
   l'application et de l'arborescence des dépendances, et pas seulement l'environnement d'exécution allégé qui sert le trafic). Les premiers déploiements
   prennent environ **20–35 minutes** (la création de Cloud SQL et le build Cloud Build à partir des sources en représentent l'essentiel).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les commandes continuent
   de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   kubectl get deploy,svc,jobs -n "$NAMESPACE" | grep -i payload
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -i payload | head -1 | cut -d/ -f2)
   echo "Service: $SERVICE"
   ```

---

## Tâche 2 — Accès et vérification [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est en bonne santé :

   ```bash
   kubectl get pods -n "$NAMESPACE" | grep -i payload   # expect N/N Running, 0 restarts
   ```

2. Déterminez comment le Service est exposé et accédez à `/admin`. Ce déploiement peut s'exécuter avec
   `service_type = "ClusterIP"` (généralement parce que le quota d'IP statiques du projet était épuisé au
   moment du déploiement) plutôt qu'avec la valeur par défaut du module, `LoadBalancer` :

   ```bash
   # If LoadBalancer with an external IP:
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   curl -s -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/admin"   # expect 200

   # If ClusterIP (no external IP) — port-forward instead:
   kubectl port-forward -n "$NAMESPACE" svc/"$SERVICE" 18080:3000
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/admin"   # expect 200
   ```

3. Ouvrez `/admin` dans un navigateur (via l'IP externe, ou `http://localhost:18080/admin` si vous
   utilisez la redirection de port). Payload ne dispose **d'aucune commande CLI permettant de créer le premier utilisateur administrateur
   de manière non interactive** — lorsque la collection `users` est vide, Payload affiche automatiquement un formulaire
   d'inscription. Saisissez votre adresse e-mail et un mot de passe, puis validez pour créer le premier administrateur ; vous êtes
   alors connecté au tableau de bord d'administration. Il s'agit d'une étape manuelle obligatoire et unique — il n'existe aucun
   identifiant administrateur pré-provisionné dans Secret Manager.

4. Si le Service est en `ClusterIP` et que vous souhaitez un accès public, passez `service_type` à
   `LoadBalancer` (ou réservez une IP statique) dans la plateforme dès que le quota d'IP le permet, puis
   appliquez à nouveau.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et ses pods :**

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   kubectl describe deploy "$SERVICE" -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails
   du déploiement — le module est propriétaire de la spécification de la charge de travail ; la mise à l'échelle est donc un changement de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply).

3. **Mettez à jour le tag de version de l'application** en modifiant le paramètre de version dans la plateforme RAD et
   en l'appliquant via **Update** ; une nouvelle exécution Cloud Build reconstruit à partir des sources l'application de démarrage Payload intégrée
   et déploie une nouvelle génération de pods (il n'existe aucun tag d'image amont à incrémenter — la mise à jour reconstruit
   toujours).

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~payload"
   kubectl get jobs -n "$NAMESPACE"   # db-init + payload-migrate + scheduled backup jobs
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. payloaddemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^payload" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project "$PROJECT" --limit 50
   ```

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads du déploiement et examinez les redémarrages de pods,
   l'utilisation du CPU et de la mémoire et (pour Cloud SQL) les métriques de requêtes et de connexions. Le module peut
   provisionner un **test de disponibilité** (uptime check) (lorsque `uptime_check_config.enabled = true` — la valeur par défaut est
   `false`, et il nécessite une IP externe joignable) ; s'il est activé, vérifiez qu'il est au vert sous
   Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions de Payload.

- **Pod en mauvaise santé / ne passe pas à l'état Ready :** examinez le pod et ses journaux pour repérer des erreurs de démarrage. La
  sonde de démarrage cible `/admin` et accorde environ 12 minutes au premier démarrage pour que la
  tâche `payload-migrate` se termine.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=payload
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Les requêtes en base échouent / « relation does not exist » :** le schéma n'a jamais été appliqué. Vérifiez que
  `payload-migrate` s'est terminée avec succès (elle dépend de la fin préalable de `db-init`) :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/payload-migrate
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le secret du mot de passe
  de la base existe, et que le conteneur sidecar Cloud SQL Auth Proxy s'exécute dans le pod
  (`kubectl get pod <pod> -n "$NAMESPACE" -o jsonpath='{.spec.containers[*].name}'`).
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec — rappelez-vous que ce
  module construit toujours à partir des sources ; un Dockerfile défectueux ou un changement de dépendance se manifeste donc ici,
  et non sous la forme d'une erreur de récupération d'image.
  ```bash
  gcloud builds list --project="$PROJECT" --limit=10
  ```
- **Pas d'IP externe / service injoignable :** vérifiez `service_type`. S'il vaut `ClusterIP` (souvent un repli délibéré quand le quota d'IP statiques du projet était épuisé), utilisez `kubectl
  port-forward` comme indiqué à la tâche 2 plutôt que de supposer que le déploiement est défaillant.
- **Premier compte administrateur absent / impossible de se connecter :** le premier administrateur est créé manuellement via le
  formulaire d'inscription `/admin` — il n'existe aucun identifiant pré-provisionné dans Secret Manager sur lequel se rabattre.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service Workload Identity.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre
(notamment pourquoi `enable_gcs_storage` et les variables Redis n'ont aucun effet sur ce module).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple
après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime
le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement
le déploiement). Delete supprime tout ce que le module a créé — la charge de travail GKE, le Service, la base de données Cloud SQL,
les secrets Secret Manager et les images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et
ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'application Payload à partir des sources via Cloud Build, provisionne la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, et exécute `db-init` → `payload-migrate` |
| 2 — Accès et vérification | Manuel | Le pod est Ready ; accéder à `/admin` (IP du LoadBalancer ou `kubectl port-forward`) et créer le premier compte administrateur |
| 3 — Exploiter | Manuel | Inspecter les pods, mettre à l'échelle, mettre à jour la version (reconstruction à partir des sources), gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter le tableau de bord GKE Workloads et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de tâche de migration, de build et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
