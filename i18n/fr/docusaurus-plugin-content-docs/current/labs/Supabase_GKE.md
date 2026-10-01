---
title: "Supabase sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Supabase sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Supabase_GKE.md @ 3055034 sha256:9d680f6255bf -->

# Supabase sur GKE Autopilot — Guide de lab {#supabase-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Supabase_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Supabase est une alternative open source à Firebase qui fournit PostgreSQL 15, une passerelle
d'API Kong, l'authentification GoTrue, des API REST PostgREST, des abonnements en temps réel
et un service de stockage compatible S3 — le tout déployé sous forme de charges de travail Kubernetes derrière une
unique IP de LoadBalancer externe. Ce lab vous fait parcourir tout le cycle de vie opérationnel
du module **Supabase on GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le supprimer.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur
les fonctionnalités de Supabase. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Supabase_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

> **GKE uniquement.** Supabase n'est disponible que dans la variante GKE. Son architecture
> multiservice requiert des connexions persistantes et des primitives Kubernetes que Cloud
> Run ne prend pas en charge.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Récupérer le secret de signature JWT et remplacer les clés d'API provisoires.
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

Définissez ces variables shell une seule fois ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Supabase (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), définissez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Supabase_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail de la passerelle Kong dans le cluster GKE Autopilot,
   déploie les services backend de Supabase — y compris une **base de données
   `supabase/postgres` dans le namespace** (le module force le `database_type` de la
   fondation à `NONE`, de sorte qu'aucune instance Cloud SQL n'est provisionnée pour elle) —
   crée six secrets Secret Manager (secret JWT, clé anon, clé service role et autres),
   provisionne un bucket Cloud Storage pour les fichiers téléversés, construit l'image de conteneur
   et exécute un job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent environ
   **20–35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et identifiez le namespace avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep supabase | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la passerelle Kong s'exécute et repérez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   Si l'IP affiche `<pending>`, attendez que le LoadBalancer soit provisionné :

   ```bash
   kubectl get svc -n "$NS" --watch
   ```

2. Vérifiez que la passerelle Kong achemine les requêtes. `kong.yml` est une configuration
   déclarative sans base de données (DB-less) sans route `/health` (seulement `/rest/v1`, `/auth/v1`,
   `/realtime/v1`, `/storage/v1`, `/pg` et `/` pour Studio) ; une requête vers
   `/health` renvoie donc 404 — utilisez plutôt la route racine de Studio :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}:8000/"
   # expect 200 (Studio dashboard, no auth required on this route)
   ```

3. Récupérez le secret de signature JWT dans Secret Manager. La clé anon et la clé service role
   sont stockées sous forme de valeurs provisoires lors du premier déploiement — elles **doivent être remplacées** par
   des JWT valides signés avec ce secret avant que les clients Supabase puissent s'authentifier :

   ```bash
   JWT_SECRET_NAME=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~supabase.*jwt-secret" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$JWT_SECRET_NAME" --project="$PROJECT"
   ```

   Utilisez la valeur renvoyée avec [jwt.io](https://jwt.io) ou le
   [générateur JWT de Supabase](https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys)
   pour générer un JWT anon signé et un JWT service role signé, puis téléversez-les :

   ```bash
   ANON_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~supabase.*anon-key" --format="value(name)" --limit=1)
   SERVICE_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~supabase.*service-role-key" --format="value(name)" --limit=1)

   echo -n "<signed-anon-jwt>" | gcloud secrets versions add "$ANON_SECRET" \
     --data-file=- --project="$PROJECT"
   echo -n "<signed-service-role-jwt>" | gcloud secrets versions add "$SERVICE_SECRET" \
     --data-file=- --project="$PROJECT"
   ```

   Redémarrez le pod Kong pour qu'il prenne en compte les secrets mis à jour :

   ```bash
   kubectl rollout restart deployment -n "$NS"
   kubectl rollout status deployment -n "$NS"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — les déploiements, les pods et (s'ils sont activés) l'autoscaler
   horizontal et les volumes persistants :

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification de la charge de travail, la mise à l'échelle est donc une modification de configuration et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update** sur la page de détails du déploiement ; une nouvelle image Kong est construite et une mise à jour progressive remplace les pods.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~supabase"
   kubectl get jobs -n "$NS"          # db-init and any additional jobs
   gcloud storage buckets list --project="$PROJECT"   # gcs-<app><tenant-prefix>-storage bucket
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance. La base de données est le
   Deployment `supabase/postgres` du namespace (`<service-name>-postgres`), et non
   Cloud SQL ; connectez-vous donc via le pod :

   ```bash
   kubectl exec -n "$NS" -it deploy/<service-name>-postgres -- \
     psql -U supabase_admin -d postgres
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
   des pods, le nombre de redémarrages et les métriques de requêtes. `uptime_check_config` est
   désactivé par défaut (`enabled = false`), et son `path` par défaut est `/health` —
   `kong.yml` ne définit aucune route de ce type ; activer le contrôle de disponibilité sans également
   remplacer `path` (par ex. par `/`, la route de Studio) produira donc un contrôle
   en échec permanent. Si vous l'activez, consultez Monitoring → Uptime checks et
   Alerting → Policies pour vérifier qu'il réussit réellement.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le
plus probablement. Ce sont des diagnostics au niveau de la plateforme, qui ne
changent pas avec les versions de Supabase.

- **Pod non prêt / CrashLoopBackOff :** inspectez les événements et les journaux :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Échec au démarrage de Kong (401 sur toutes les requêtes) :** les secrets de la clé anon ou de la clé service role
  contiennent encore des valeurs provisoires. Remplacez-les par des JWT signés valides
  (voir la tâche 2, étape 3) et redémarrez le déploiement.
- **Erreurs de connexion à la base de données :** vérifiez que le pod `<service-name>-postgres` du namespace
  est `Running`, et que le job `db-init` (qui définit les mots de passe des rôles de connexion
  des services Supabase) s'est terminé avec succès.
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<service-name>-db-init
  ```
- **Pod en attente / aucune IP externe :** consultez les événements de `kubectl describe pod` à la recherche de problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer a reçu une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image Kong existe dans Artifact Registry (la mise en miroir
  des images est toujours activée) et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre, notamment l'immuabilité de l'ensemble des secrets JWT et l'exigence
d'unités binaires pour les valeurs de quota mémoire.

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son namespace, la base de données Cloud SQL, les secrets Secret Manager, le bucket Cloud Storage et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE,
le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la passerelle Kong, la base de données `supabase/postgres` du namespace, les secrets et le bucket de stockage, et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; les JWT provisoires sont remplacés par des clés signées |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer secrets/stockage/jobs, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le contrôle de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de JWT/authentification, de base de données, de job d'initialisation, de planification et de récupération d'image |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
