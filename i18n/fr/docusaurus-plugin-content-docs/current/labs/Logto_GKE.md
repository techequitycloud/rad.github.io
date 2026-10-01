---
title: "Logto sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Logto sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Logto_GKE.md @ 3055034 sha256:c3af42574579 -->

# Logto sur GKE Autopilot — Guide de lab {#logto-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Logto_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Logto est un fournisseur d'identité open source — une alternative à Auth0 qui prend en charge OIDC
et OAuth 2.0, avec des flux de connexion, des connecteurs sociaux et d'entreprise, le multi-tenant et
une console d'administration. Ce lab vous fait parcourir le cycle de vie opérationnel complet du
module **Logto on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Logto. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Logto_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d'exécution et atteindre la console
  d'administration pour la configuration initiale.
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

1. Dans la navigation supérieure de la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, ouvrez **Logto (GKE)** dans
   la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Logto_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec son secret Secret Manager (le mot de passe
   de la base de données — Logto n'a pas de secret applicatif externe ; ses clés de signature OIDC sont
   générées dans la base de données au premier démarrage), un bucket Cloud Storage, construit
   l'image du conteneur et exécute un job ponctuel d'initialisation de la base de données qui crée
   le rôle applicatif (avec `CREATEROLE`) et la base de données. Un Service LoadBalancer
   avec une IP statique réservée et un domaine personnalisé nip.io est provisionné par défaut.
   Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et repérez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep logto | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Logto expose un point de terminaison d'état non authentifié
   qui ne répond qu'une fois le cœur démarré et son schéma initialisé :

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/status"   # expect HTTP 200
   ```

3. **La console d'administration n'est pas accessible sur l'IP externe.** Le Service n'expose
   que le cœur (port 3001, OIDC) ; la console d'administration — où vous créez le premier
   administrateur et enregistrez les applications OIDC — s'exécute sur le port 3002. Atteignez-la via
   une redirection de port directement vers le pod :

   ```bash
   kubectl port-forward -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 3002:3002
   # then open http://localhost:3002
   ```

4. Créez le premier compte administrateur et enregistrez votre première application
   OIDC. Notez que l'URI de redirection enregistrée doit utiliser le même hôte que
   `ENDPOINT` (voir la tâche 5) — une discordance casse chaque rappel OAuth.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le Deployment, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module détient la spécification de la charge de travail, la mise à l'échelle est donc une
   modification de configuration et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors de l'application suivante). GKE exige `min_instance_count >= 1` (pas de
   mise à l'échelle à zéro) ; l'affinité de session (`ClientIP`) est définie par défaut afin qu'un client
   atteigne toujours le même pod.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour
   progressive remplace les pods. En production, figez `application_version` sur une version précise
   (par ex. `1.33`) plutôt que de suivre `latest`.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~logto"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. logtodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^logto" --limit=1)
   DB_NAME=$(gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^logto" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_NAME" --project="$PROJECT"
   ```

   N'effacez ni ne réinitialisez jamais cette base de données en dehors d'une restauration volontaire — les clés
   de signature OIDC de Logto n'existent que dans celle-ci, et l'effacer invalide chaque jeton émis
   et chaque client enregistré.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou le Logs Explorer. Le point d'entrée affiche une
   ligne `[cloud-entrypoint]` indiquant le mode de connexion à la base de données résolu et
   `ENDPOINT`, c'est la première chose à vérifier pour diagnostiquer un problème de connexion ou
   d'URL d'émetteur :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Un **test de disponibilité** est
   désactivé par défaut ; le module peut en provisionner un sur l'hôte du LoadBalancer
   lorsqu'il est activé — examinez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Logto.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux. Les sondes de vivacité et
  de démarrage ciblent `/api/status`, avec une large fenêtre au premier démarrage pour l'étape
  d'initialisation du schéma et des clés OIDC ; un échec de connexion à PostgreSQL empêche le pod
  de passer à l'état Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs OIDC / de rappel de connexion :** confirmez que `ENDPOINT` correspond exactement à l'hôte
  externe du LoadBalancer ou du domaine personnalisé que le navigateur a utilisé pour atteindre Logto — Logto
  construit son émetteur OIDC et chaque URL de redirection absolue à partir de cette valeur.
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE` et que
  le secret du mot de passe de la base a bien été matérialisé dans le namespace via le pilote Secret Store
  CSI. Sur GKE, le sidecar Auth Proxy écoute sur `127.0.0.1` ; le point d'entrée
  se connecte en TCP simple sur la boucle locale avec SSL désactivé (le proxy termine le TLS) —
  cela diffère du chemin par IP privée utilisé sur Cloud Run.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Console d'administration inaccessible :** c'est attendu sur l'IP externe — voir la tâche 2.
  La console d'administration (3002) n'est jamais publiée sur le Service LoadBalancer ; utilisez plutôt une
  redirection de port.
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour détecter des
  problèmes de ressources ou de quota, et confirmez que le Service LoadBalancer dispose d'une IP
  attribuée.
- **Erreurs de récupération d'image :** confirmez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la règle essentielle de ne jamais effacer la base de données Cloud SQL, puisque
la seule copie des clés de signature OIDC de Logto s'y trouve).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et le namespace, la base de données Cloud SQL (et avec elle la seule copie des clés de signature
OIDC de Logto), le secret Secret Manager, le bucket GCS et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé,
le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), un secret pour le mot de passe de la base, un bucket de stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit ; accès à la console d'administration par redirection de port pour créer le premier administrateur |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets et le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, d'OIDC/de rappel, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
