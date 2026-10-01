---
title: "Ghostfolio sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Ghostfolio sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Ghostfolio_GKE.md @ 3055034 sha256:00780eafc161 -->

# Ghostfolio sur GKE Autopilot — Guide de lab {#ghostfolio-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghostfolio_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Ghostfolio est une application open source de gestion de patrimoine permettant de suivre la valeur nette,
les portefeuilles d’investissement et l’allocation d’actifs sur plusieurs comptes de courtage.
Ce lab vous fait parcourir le cycle de vie opérationnel complet du module **Ghostfolio sur
GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l’exploiter
au quotidien, l’observer, diagnostiquer les problèmes courants, puis le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Ghostfolio. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghostfolio_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder à la charge de travail en cours d’exécution et la vérifier, y compris son contrôle de santé combiné base de données + Redis.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour, et gérer les secrets et les sauvegardes.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le cluster GKE Autopilot, le VPC, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # from the deployment outputs

gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Ghostfolio (GKE)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ghostfolio_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Notez que `enable_redis`
   vaut `true` par défaut et est OBLIGATOIRE — ne le désactivez pas. Cliquez sur **Deploy Module**,
   vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d’état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le Deployment et le Service GKE, une base de données Cloud SQL
   (PostgreSQL 15) avec ses secrets Secret Manager
   (`ACCESS_TOKEN_SALT`, `JWT_SECRET_KEY` et le mot de passe de la base de données), construit
   l’image de conteneur et exécute un Job ponctuel d’initialisation de la base de données. Un premier
   déploiement prend environ **20 à 35 minutes** (la création de Cloud SQL représente l’essentiel du temps).

3. Une fois terminé, repérez les ressources à l’aide de filtres indépendants du nom :

   ```bash
   kubectl get deployment -n "$NAMESPACE" | grep -i ghostfolio
   kubectl get svc -n "$NAMESPACE" | grep -i ghostfolio
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" -l app=ghostfolio \
     -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "Service IP: $SERVICE_IP"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le pod est en bonne santé et connecté À LA FOIS à sa base de données ET à Redis.
   Le point de terminaison de santé de Ghostfolio contrôle les deux dépendances et renvoie 503 tant que
   les deux ne sont pas joignables :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://$SERVICE_IP/api/v1/health"   # expect 200
   curl -s "http://$SERVICE_IP/api/v1/health"                                    # expect {"status":"OK"}
   kubectl get pods -n "$NAMESPACE" -l app=ghostfolio   # expect N/N Running, 0 restarts
   ```

2. Ouvrez `http://$SERVICE_IP` (ou le domaine personnalisé que vous avez configuré) dans un navigateur.
   Ghostfolio n’a **aucun formulaire de connexion par e-mail et mot de passe** — cliquez sur **Get Started** et
   l’application génère un « Security Token » anonyme aléatoire qui sert d’identifiant au propriétaire
   de votre compte. Conservez ce jeton ; c’est votre seul identifiant pour ce compte.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son historique de déploiement :**

   ```bash
   kubectl describe deployment <deployment-name> -n "$NAMESPACE"
   kubectl rollout history deployment/<deployment-name> -n "$NAMESPACE"
   ```

2. **Mettez à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module possède la spécification du Deployment ; la mise à l’échelle
   est donc une modification de configuration, et non un `kubectl scale` manuel (une mise à l’échelle manuelle serait
   annulée lors du prochain apply, même si `kubectl scale --replicas=0` est la
   méthode documentée pour mettre temporairement en pause un déploiement vérifié).

3. **Mettez à jour le tag de version de l’application** en modifiant le paramètre de version dans la
   plateforme RAD et en l’appliquant via **Update** ; une nouvelle image est construite et le
   Deployment est redéployé.

4. **Gérez les secrets et les sauvegardes :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ghostfolio"
   kubectl get jobs -n "$NAMESPACE"   # init jobs
   ```

5. **Ouvrez une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. ghostfoliodemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^ghostfolio" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   kubectl logs -n "$NAMESPACE" -l app=ghostfolio --tail=100
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — examinez l’utilisation du CPU et de la mémoire des pods ainsi que le nombre de redémarrages. Le
   module peut provisionner un **test de disponibilité** (uptime check) (lorsque
   `uptime_check_config.enabled = true` — sa valeur par défaut est `false`) ; s’il est activé,
   vérifiez qu’il est au vert sous Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Ghostfolio à l’autre.

- **Pod non Ready / en boucle de plantage :** inspectez les événements et les journaux du pod à la recherche d’erreurs
  de démarrage. La sonde de démarrage cible `/api/v1/health`, qui échoue tant que la
  base de données ET Redis ne sont pas TOUS DEUX joignables — un 503 à ce stade signifie souvent que Redis n’est pas encore
  joignable, et non un problème de base de données.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=ghostfolio
  kubectl logs -n "$NAMESPACE" -l app=ghostfolio --previous
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE`
  et que le conteneur sidecar cloud-sql-proxy s’exécute dans le pod
  (`kubectl get pod <pod> -o jsonpath='{.spec.containers[*].name}'`). Sur GKE,
  le point d’entrée cloud de Ghostfolio s’attend à ce que `DB_IP` se résolve en `127.0.0.1`
  (la boucle locale du proxy) avec `sslmode=disable`.
- **Erreurs de connexion à Redis :** si `redis_host` a été laissé vide, vérifiez que la
  VM du serveur NFS de la plateforme est `RUNNING` ; sinon `REDIS_HOST` est vide et le
  contrôle de santé ne réussit jamais.
- **Le Job d’initialisation a échoué :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Le build de l’image a échoué :** consultez l’historique Cloud Build pour lire le journal du build en échec.
- **Inaccessible depuis un navigateur :** vérifiez que `service_type = "LoadBalancer"` (la
  valeur par défaut) et qu’une adresse IP externe a été attribuée
  (`kubectl get svc -n "$NAMESPACE"`).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment la règle essentielle de ne jamais faire tourner `ACCESS_TOKEN_SALT` après le
premier démarrage).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du
déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD
ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec
l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Delete supprime tout ce que le module a créé — le Deployment et le
Service GKE, la base de données Cloud SQL, les secrets Secret Manager et les images Artifact Registry.
Les ressources appartenant à **Services_GCP** (le cluster GKE, le VPC, le Cloud SQL partagé, le
registre, l’hôte Redis NFS) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le Deployment/Service GKE, Cloud SQL (PostgreSQL 15), des secrets, et exécute l’initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit (base de données + Redis) ; générer un Security Token anonyme via « Get Started » |
| 3 — Exploiter | Manuel | Inspecter le déploiement progressif, mettre à l’échelle, mettre à jour la version, gérer secrets/sauvegardes, accès à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de Redis, de job d’initialisation, de build et de réseau |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
