---
title: "Castopod sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Castopod sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Castopod_CloudRun.md @ 3055034 sha256:6b76f2a4fcea -->

# Castopod sur Cloud Run — Guide de lab {#castopod-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Castopod_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Castopod est une plateforme open source d'hébergement de podcasts, nativement compatible ActivityPub, construite sur CodeIgniter 4 (PHP 8) et servie par FrankenPHP/Caddy. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module **Castopod on Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**, et non sur les fonctionnalités de Castopod. Pour la liste complète des services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Castopod_CloudRun) — ce lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution, le vérifier et terminer l'assistant d'installation de Castopod.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets, les médias et les sauvegardes.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Cloud SQL, le NFS Filestore, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** authentifié : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Castopod (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Castopod_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (FrankenPHP/Caddy sur le port 8080), une
   base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager (le mot de passe de la base ainsi que
   le `CP_ANALYTICS_SALT` généré automatiquement), un bucket GCS `media`, un partage NFS pour
   le stockage durable de l'audio et des visuels des épisodes, construit l'image de conteneur personnalisée (un build
   léger au-dessus de l'image amont `castopod/castopod` qui y greffe le point d'entrée
   de la plateforme), puis exécute un job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent
   environ **20 à 35 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~castopod" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain. La page d'accueil non authentifiée `/` de Castopod renvoie
   HTTP 200 une fois l'application démarrée et connectée à MySQL — CodeIgniter exécute ses
   migrations de schéma au premier démarrage, prévoyez donc quelques minutes sur un nouveau déploiement :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur et terminez l'**assistant d'installation web** de Castopod —
   créez le premier compte super-administrateur et définissez le nom de l'instance et les valeurs par défaut
   des podcasts. L'URL de base est dérivée automatiquement de l'URL du service à l'exécution, si bien que
   les liens de flux et de médias pointent vers le bon hôte. Le mot de passe de la base de données (dans Secret
   Manager) peut être récupéré si nécessaire :

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~castopod" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

3. Téléversez un court épisode de test (audio + visuel) et vérifiez que le flux RSS public
   s'affiche. Les flux publics et les téléchargements de médias expliquent pourquoi `ingress_settings = "all"` est
   la valeur par défaut — ne le restreignez pas (et n'ajoutez pas IAP) sur une instance de podcast publique.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui soit saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update** sur la page de détails du déploiement —
   le module possède la spécification du service, donc la mise à l'échelle est une modification de configuration, et non une
   modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la prochaine application). La
   valeur par défaut est la réduction à zéro (`min = 0`) avec `max = 1` ; conservez `max_instance_count = 1`
   tant que le système de fichiers de médias partagé et le cache ne sont pas confirmés compatibles avec plusieurs instances.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version via **Update**
   sur la page de détails du déploiement ; une nouvelle image est construite et une nouvelle révision est déployée,
   appliquant au premier démarrage toutes les migrations CodeIgniter en attente.

4. **Gérez les secrets, le stockage des médias et les jobs :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~castopod"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   gcloud storage buckets list --project="$PROJECT" --filter="name~media"
   gcloud filestore instances list --project="$PROJECT"           # NFS for media
   ```

   Gardez `CP_ANALYTICS_SALT` stable — il anonymise les statistiques d'audience, et le modifier
   rompt la continuité de la déduplication pour les auditeurs déjà enregistrés.

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. castopoddemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^castopod" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle, y compris
   les périodes de réduction à zéro) et l'utilisation CPU / mémoire. Les récupérations de flux par les applications
   de podcast apparaissent sous forme de trafic de requêtes de fond régulier. Consultez Monitoring → Uptime
   checks et Alerting → Policies pour les tests provisionnés.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Castopod.

- **Révision non saine / le service ne répond pas :** la sonde de démarrage est de type TCP, avec une
  fenêtre de nouvelles tentatives qui couvre les migrations CodeIgniter du premier démarrage ; la sonde de vivacité
  interroge `/`. Examinez la dernière révision et ses journaux avant de conclure que le service
  a échoué :
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL (MySQL 8.0) est
  `RUNNABLE`, que le secret du mot de passe de la base existe et que le job `db-init` s'est terminé. Notez que
  Castopod se connecte via l'adresse **TCP en IP privée** (le pilote `mysqli` de CodeIgniter
  ne peut pas utiliser le répertoire de sockets de l'Auth Proxy) — le point d'entrée gère cela
  automatiquement.
- **Échec du job d'initialisation :** listez les exécutions et lisez les journaux de celle qui a échoué :
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Les fichiers téléversés disparaissent après un redémarrage :** vérifiez que `enable_nfs = true` et que l'instance
  Filestore est saine — sans NFS, l'audio et les visuels des épisodes résident sur un disque
  éphémère et sont perdus à chaque redémarrage ou redéploiement.
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour le journal du build en échec.
  L'image est un build personnalisé au-dessus de `castopod/castopod` qui greffe le point d'entrée
  chargé d'écrire la configuration de la base dans le `.env` de Castopod — l'image amont seule
  ne peut pas exploiter les identifiants injectés.
- **Liens de flux ou de médias cassés :** le point d'entrée dérive l'URL de base de l'URL du
  service à l'exécution ; si vous êtes passé à un domaine personnalisé, redéployez pour que les flux prennent en compte
  le nouvel hôte.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution ; si
  IAP a été activé, rappelez-vous qu'il bloque *tout* accès non authentifié — y compris
  les flux RSS publics et les téléchargements de médias.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
la base de données Cloud SQL (podcasts, épisodes, utilisateurs, statistiques), les secrets Secret Manager
(y compris `CP_ANALYTICS_SALT`), le bucket GCS `media`, le partage NFS contenant
l'audio et les visuels téléversés, ainsi que les images d'Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, Cloud SQL (MySQL 8.0), le NFS, le bucket de médias et les secrets, construit l'image et exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | La page d'accueil renvoie 200 ; terminer l'assistant d'installation ; téléverser un épisode de test et vérifier le flux |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets/médias/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et les tests de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de base de données, de job d'initialisation, de médias NFS, de build, d'URL de base et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
