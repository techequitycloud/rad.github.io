---
title: "Excalidraw sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Excalidraw sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Excalidraw_CloudRun.md @ 3055034 sha256:29a58a5926c4 -->

# Excalidraw sur Cloud Run — Guide de lab {#excalidraw-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Excalidraw_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Excalidraw est un tableau blanc virtuel open source permettant d'esquisser des diagrammes au style
dessiné à la main, des maquettes et des dessins collaboratifs rapides. La distribution auto-hébergée est
une **application monopage statique servie par nginx** — il n'y a ni backend, ni base de données, ni
comptes utilisateurs. Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module
**Excalidraw on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter
au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Excalidraw. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Excalidraw_CloudRun) —
ce lab ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle et mettre à jour le déploiement.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Excalidraw (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Excalidraw_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme construit une image personnalisée minimale (`FROM excalidraw/excalidraw`), la copie
   dans Artifact Registry et provisionne le service Cloud Run. Il n'y a **ni instance Cloud
   SQL, ni secret Secret Manager, ni bucket GCS, ni Redis** — Excalidraw est
   un frontend statique entièrement sans état ; ce déploiement est donc l'un des plus rapides du
   catalogue, généralement **5 à 10 minutes** (dominé par le build de l'image).

3. Une fois l'opération terminée, découvrez la ressource à l'aide d'un filtre indépendant des noms (pour que la commande
   continue de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~excalidraw" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. nginx répond `200` sur le chemin racine dès que
   la révision sert le trafic — il n'y a ni base de données ni backend à attendre :

   ```bash
   curl -sI "$SERVICE_URL/" | head -1     # expect: HTTP/2 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Le tableau blanc se charge immédiatement — il n'y a ni
   connexion, ni compte administrateur, ni configuration initiale. Dessinez quelque chose et utilisez **Export**
   (menu → Export) pour enregistrer un fichier `.excalidraw`, PNG ou SVG ; c'est le seul
   mécanisme de persistance, puisque les dessins ne résident sinon que dans le stockage local
   du navigateur.

3. Notez que la fonctionnalité de collaboration en temps réel par « lien partageable » n'est **pas**
   disponible — elle dépend d'un serveur WebSocket `excalidraw-room` distinct que ce
   module ne déploie pas. L'édition par un seul utilisateur fonctionne entièrement dès l'installation.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant le paramètre de nombre maximal d'instances et en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification du service, la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait annulée lors de
   l'application suivante). `min_instance_count` est forcé à `0` par le wrapper : Excalidraw n'a
   aucun travail en arrière-plan à maintenir actif ; la mise à l'échelle jusqu'à zéro est donc toujours active et les déploiements inactifs
   ne coûtent rien. Comme chaque requête est servie de manière identique à partir de fichiers statiques, il n'y a
   pas d'affinité de session à prendre en compte lors de la montée en charge horizontale.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite à partir d'une nouvelle étiquette `excalidraw/excalidraw`
   et une nouvelle révision est déployée. Comme il n'y a aucun état côté serveur, les mises à niveau et
   les retours arrière sont triviaux — le trafic peut être rebasculé vers une révision antérieure à tout moment,
   sans souci de cohérence des données.

4. **Vérifiez qu'il n'y a rien d'autre à gérer :** contrairement à la plupart des modules, Excalidraw n'a ni
   secrets, ni jobs de sauvegarde, ni base de données à inspecter :

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~excalidraw"          # (none)
   gcloud sql instances list --project="$PROJECT" --filter="name~excalidraw"    # (none)
   gcloud run jobs list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~excalidraw"                                       # (none)
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) (journaux d'accès et d'erreurs nginx) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et
   l'utilisation du processeur et de la mémoire. Comme l'application est un serveur de fichiers statiques, la latence doit être
   constamment faible et l'utilisation du processeur minimale. Le module provisionne également un **test de
   disponibilité** ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Excalidraw à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. La sonde de démarrage cible la racine `/`, à laquelle nginx devrait
  répondre en une ou deux secondes — une sonde qui échoue de manière persistante signale presque toujours un
  problème de conteneur ou d'image, et non une dépendance applicative (il n'y a aucune base de données à attendre).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **La sonde de démarrage ne réussit jamais / mauvais port :** vérifiez que le port d'écoute de la révision en cours
  correspond au port nginx intégré à l'image (`80`) — il est fixé dans l'image et ne doit
  pas être modifié via `container_port` :
  ```bash
  gcloud run services describe "$SERVICE" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```
- **`Image not found` :** vérifiez que `container_image_source` vaut `custom` (la valeur par défaut) et
  que l'historique Cloud Build montre un build et un envoi réussis vers Artifact Registry.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.
- **Tableau blanc inaccessible depuis un navigateur :** vérifiez que `ingress_settings` vaut `all` (la
  valeur par défaut) — `internal` limite l'accès au seul VPC.
- **La collaboration en temps réel ne fonctionne pas :** c'est le comportement attendu — le module ne
  déploie pas le serveur WebSocket `excalidraw-room` distinct que requiert la fonctionnalité
  « lien partageable ».

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres
à chaque paramètre (notamment le port fixe et la mise en garde sur l'étiquette `latest` en production).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run et
son image Artifact Registry. Il n'y a ni base de données Cloud SQL, ni secret Secret Manager, ni
bucket GCS à nettoyer, puisqu'aucun n'a été créé. Les ressources appartenant à **Services_GCP**
(le VPC, le registre partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit et copie l'image statique, et provisionne le service Cloud Run — ni base de données, ni secrets, ni stockage |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit immédiatement ; le tableau blanc se charge sans connexion ni configuration |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle (mise à l'échelle jusqu'à zéro forcée), mettre à jour la version — aucun secret, aucune base de données ni sauvegarde à gérer |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de port, de build et d'entrée (ingress) |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
