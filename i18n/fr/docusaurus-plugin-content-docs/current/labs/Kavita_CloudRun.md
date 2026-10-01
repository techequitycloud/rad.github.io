---
title: "Kavita sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Kavita sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Kavita_CloudRun.md @ 3055034 sha256:37e2ed92e8be -->

# Kavita sur Cloud Run — Guide de lab {#kavita-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Kavita est une bibliothèque numérique et un serveur de lecture rapides et
auto-hébergés pour les bandes dessinées, les mangas et les livres numériques — une
interface de lecture web, des flux OPDS, des collections, des listes de lecture et
une recherche plein texte, construits sur .NET avec une base de données SQLite
interne. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**Kavita on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
supprimer.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Kavita. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe),
consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et terminer l'assistant de configuration du premier lancement.
- Effectuer les opérations du jour 2 : inspecter, mettre à l'échelle (ou plutôt comprendre pourquoi ne pas le faire), mettre à jour, et gérer le stockage et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module — Kavita lui-même n'a pas besoin de Cloud SQL). Vous
  n'avez pas besoin de le déployer vous-même au préalable : la plateforme détecte
  automatiquement s'il existe déjà dans le projet cible et, sinon, le provisionne
  avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans ce projet, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que propriétaire (Owner) du projet les commandes affichées, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; toutes les tâches ci-dessous les réutilisent :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Kavita (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez
   en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run et un bucket Cloud Storage
   (monté sur `/kavita/config` via GCS Fuse), construit l'image de conteneur
   personnalisée (une fine surcouche de `jvmilazz0/kavita`) et démarre le service. Il
   n'y a **aucune base de données à provisionner ni aucune tâche d'initialisation à
   attendre** — Kavita gère sa propre base de données SQLite interne. Un premier
   déploiement se termine généralement en **5–10 minutes** (l'essentiel étant le build
   de l'image).

3. Une fois l'opération terminée, repérez la ressource à l'aide d'un filtre
   indépendant des noms (pour que la commande fonctionne quel que soit le suffixe du
   déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~kavita" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. Kavita expose un point de terminaison de santé
   public et non authentifié qui renvoie `200` dès que le serveur répond :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/health"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Lors de la première visite,
   l'**assistant de configuration du premier lancement** de Kavita vous guide dans la
   création du compte administrateur initial et l'ajout de votre première
   bibliothèque — il n'existe aucun identifiant administrateur prédéfini dans Secret
   Manager. Faites-le rapidement : tant que l'assistant n'a pas été exécuté, le
   service est joignable mais non revendiqué, et quiconque atteint l'URL en premier
   peut créer le compte administrateur.

3. Ce module ne conserve que le répertoire d'**état** de Kavita (`/kavita/config` —
   paramètres, base de données SQLite, couvertures). Il ne provisionne pas le contenu
   réel de la bibliothèque. Pour lire quoi que ce soit, ajoutez vos propres
   `gcs_volumes` (ou un montage NFS) pointant vers vos fichiers de bandes dessinées,
   de mangas ou de livres numériques, et enregistrez ce chemin comme bibliothèque dans
   l'interface de Kavita.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `min_instance_count` vaut `1` par défaut
   (contrairement à la plupart des modules, qui descendent à zéro par défaut — cela
   évite les délais de démarrage à froid pendant que gcsfuse remonte le volume et que
   Kavita recharge l'index de sa bibliothèque) et `max_instance_count` est fixé à `1`.
   Kavita ne dispose d'aucun clustering ni d'aucune coordination des écritures
   partagées : une seconde instance écrivant dans le même fichier SQLite monté via
   gcsfuse risque de corrompre l'index de la bibliothèque — laissez donc
   `max_instance_count` à `1`.

3. **Tenez compte de la couche de stockage.** Cloud Run ne propose pas de volume
   persistant en mode bloc ; `/kavita/config` (la base de données SQLite et les
   paramètres) est donc toujours monté ici via GCS Fuse — le seul endroit de ce module
   où l'avertissement habituel du dépôt (« gcsfuse corrompt SQLite ») est inévitable
   plutôt qu'une erreur de configuration. Ce module convient surtout aux bibliothèques
   de taille petite à moyenne ; pour de grandes bibliothèques ou des analyses de
   métadonnées intensives, préférez
   [Kavita_GKE](https://docs.radmodules.dev/docs/modules/Kavita_GKE), dont le PVC en
   mode bloc par défaut est l'option la plus sûre et à plus faible latence.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est
   construite et une nouvelle révision est déployée. Notez que
   `application_version = "latest"` correspond à un argument de build fixé,
   `KAVITA_VERSION = 0.8.7`, dans `Kavita_Common`, et non au tag générique injecté par
   la Foundation — changer de version exige de modifier cette valeur fixée et de
   reconstruire l'image, et pas seulement de redéployer.

5. **Inspectez et sauvegardez le stockage :**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~kavita"
   gcloud storage ls gs://<config-bucket>/          # bucket name is in the Outputs
   ```

   Les sauvegardes s'exécutent selon le `backup_schedule` du module (par défaut
   `0 2 * * *` UTC) et restaurent l'ensemble du répertoire `/kavita/config` — Kavita
   n'a pas de vidage de base de données distinct, puisque son état est le répertoire
   de configuration lui-même.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre pour l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, leur latence, le nombre d'instances ainsi que l'utilisation du
   CPU et de la mémoire. Un **test de disponibilité** (uptime check) facultatif sur
   `/api/health` peut être activé (`uptime_check_config`, désactivé par défaut) ; s'il
   est activé, vérifiez qu'il est au vert sous Monitoring → Uptime checks et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus
probablement. Il s'agit de diagnostics au niveau de la plateforme, qui ne changent pas
d'une version de Kavita à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière
  révision et ses journaux à la recherche d'erreurs de démarrage. La sonde de démarrage
  (startup probe) cible `/api/health` avec une marge d'échec généreuse (10 tentatives)
  afin de tolérer l'indexation de la bibliothèque au premier démarrage avant que la
  sonde de vivacité (liveness probe) ne prenne le relais.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Service joignable mais bibliothèque/données absentes après un redéploiement :**
  vérifiez que le bucket `storage` est toujours monté sur `/kavita/config` et que
  personne n'a fait pointer le module par erreur vers un autre bucket — ce répertoire
  constitue la totalité de l'état durable de Kavita.
- **Temps de réponse lents ou erreurs occasionnelles sous charge :** c'est le
  compromis attendu d'un SQLite reposant sur GCS Fuse pour une bibliothèque petite ou
  moyenne ; si le problème persiste, envisagez de migrer vers
  [Kavita_GKE](https://docs.radmodules.dev/docs/modules/Kavita_GKE) et son stockage
  reposant sur un PVC en mode bloc.
- **Le flux OPDS ou l'application de lecture mobile ne parvient pas à se connecter :**
  vérifiez que `enable_iap = false` (valeur par défaut) — le flux OPDS de Kavita et
  les applications de lecture mobiles ne peuvent généralement pas mener à bien le flux
  d'authentification de Google IAP — et que `ingress_settings = "all"`.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le
  journal du build en échec ; une cause fréquente est un `KAVITA_VERSION` modifié qui
  pointe vers un tag inexistant en amont.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (y compris la raison pour laquelle `max_instance_count` doit
rester à `1` et pourquoi `enable_redis`/`enable_cloudsql_volume` sont sans effet pour ce
module).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run
et le bucket Cloud Storage contenant l'intégralité de l'état de Kavita (base de données
SQLite, paramètres, couvertures, sauvegardes). Les ressources appartenant à
**Services_GCP** (le VPC, Artifact Registry) sont gérées séparément et ne sont pas
supprimées ici. Comme ce bucket **est** l'index de la bibliothèque et la progression de
lecture, assurez-vous de disposer d'une sauvegarde ou d'un export qui vous importe avant
la suppression.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run et le bucket de configuration monté via GCS Fuse ; pas de base de données, pas de tâche d'initialisation |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; terminer l'assistant du premier lancement pour créer le compte administrateur et la première bibliothèque |
| 3 — Exploiter | Manuel | Inspecter les révisions, conserver `max_instance_count = 1`, mettre à jour la version, gérer le stockage/les sauvegardes |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité facultatif |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de stockage, d'OPDS/IAP, de build et d'IAM |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le bucket contenant l'intégralité de l'état de Kavita |
