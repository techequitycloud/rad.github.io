---
title: "Ntfy sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Ntfy sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Ntfy_CloudRun.md @ 3055034 sha256:00bc78da16d9 -->

# Ntfy sur Cloud Run — Guide de lab {#ntfy-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ntfy_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

ntfy est un serveur open source de notifications push en mode pub/sub : les applications publient
des messages via une API REST/HTTP simple et les clients les reçoivent instantanément via des flux
WebSocket ou Server-Sent-Events, sans aucune base de données externe. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **ntfy on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit ntfy. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Ntfy_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier, notamment par un test rapide de publication/abonnement.
- Effectuer les opérations du jour 2 — inspecter, tenir compte des contraintes de mise à l'échelle, mettre à jour et gérer
  les secrets.
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
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Ntfy (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Ntfy_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne un unique service Cloud Run v2 exécutant le binaire Go
   de ntfy et construit l'image du conteneur. Aucune base de données, aucun cache ni aucun bucket
   de stockage d'objets n'est provisionné — ntfy conserve son cache de messages dans un fichier SQLite local.
   Il n'y a aucun job d'initialisation de base de données à attendre ; un premier déploiement est donc
   généralement bien plus rapide que pour un module adossé à une base de données (environ **5–10 minutes**,
   l'essentiel étant consacré au build de l'image).

3. Une fois l'opération terminée, repérez le service avec un filtre indépendant des noms (afin que la
   commande continue de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ntfy" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Le point de terminaison de santé de ntfy répond dès que le
   serveur s'est lié à son port — il n'y a aucune dépendance de base de données à attendre :

   ```bash
   curl -s "$SERVICE_URL/v1/health"   # expect {"healthy":true}
   ```

2. Exécutez un test rapide de publication/abonnement :

   ```bash
   curl -d "hello from ntfy" "$SERVICE_URL/mytopic"     # publish
   curl -s "$SERVICE_URL/mytopic/json"                   # subscribe (streaming JSON; Ctrl-C to stop)
   ```

   Ouvrez `$SERVICE_URL/mytopic` dans un navigateur pour voir l'interface web intégrée recevoir le
   message en temps réel.

3. ntfy est livré en **accès ouvert** — n'importe quel client peut publier sur n'importe quel sujet
   ou s'y abonner via l'URL publique. Il n'y a aucun compte administrateur à créer. Si vous avez besoin d'un
   contrôle d'accès, configurez des utilisateurs et des ACL par sujet après le déploiement via la CLI de ntfy
   (`ntfy user add`, `ntfy access`) ou en définissant des variables d'environnement `NTFY_AUTH_*`
   dans `environment_variables` et en les appliquant via **Update**. Si vous prévoyez
   d'utiliser des pièces jointes ou le web-push du navigateur, définissez également `NTFY_BASE_URL` sur `$SERVICE_URL`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `max_instance_count` vaut `1` par défaut et
   doit le rester — le flux WebSocket/SSE d'un abonné est ancré à l'instance
   qui le détient, et ntfy ne dispose d'aucun bus de messages partagé. Augmenter le nombre d'instances répartit
   silencieusement les abonnés entre les instances, de sorte qu'un message publié sur une
   instance n'est jamais remis à un abonné rattaché à une autre. Toute modification du
   nombre minimal/maximal d'instances se fait depuis la page de détails du déploiement de la plateforme RAD et
   s'applique via **Update**, et non par une modification manuelle avec `gcloud` (qui serait annulée lors de
   la prochaine application).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. En production, fixez une version `v2.x.y` explicite plutôt que de vous appuyer sur
   `latest`.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ntfy"
   ```

   ntfy ne génère aucun secret propre au moment du déploiement — cette liste n'est
   renseignée que si vous avez fourni des entrées via `secret_environment_variables`.

5. **Activez un historique de messages durable**, si le cache éphémère par défaut n'est pas
   acceptable : définissez `enable_nfs = true` et faites pointer le répertoire de `NTFY_CACHE_FILE` vers
   le montage NFS, puis appliquez via **Update**. Sans cela, le cache SQLite est
   perdu à chaque redémarrage ou redéploiement.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   ntfy journalise son adresse d'écoute et le chemin résolu de son cache au démarrage — vérifiez ici
   en premier si le cache s'est rabattu sur `/tmp/ntfy`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de
   requêtes, la latence des requêtes, le nombre d'instances et l'utilisation du CPU / de la mémoire. Comme
   `cpu_always_allocated = true` par défaut, attendez-vous à une consommation CPU de base stable même à
   faible trafic — c'est nécessaire pour maintenir les flux des abonnés, et non une
   erreur de configuration. Si un **test de disponibilité** (uptime check) Cloud Monitoring est activé, vérifiez qu'il
   est au vert sous Monitoring → Uptime checks, et consultez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de ntfy.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d'erreurs de démarrage. Les sondes de démarrage et de vivacité ciblent toutes deux
  `/v1/health`, qui doit renvoyer `200` quelques secondes après le démarrage — ntfy n'a aucune
  base de données à attendre ; une sonde lente ou en échec indique donc généralement un problème de build du
  conteneur ou de configuration plutôt qu'une dépendance en aval.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Des messages « disparaissent » ou les abonnés ne voient pas l'historique :** vérifiez
  `max_instance_count` (qui doit valoir `1`) et si `enable_nfs` est défini — avec le
  cache éphémère par défaut, un redémarrage ou un redéploiement efface l'historique des messages par conception,
  ce que l'on confond facilement avec un bug de remise.
- **Les pièces jointes ou les liens web-push sont cassés :** vérifiez que `NTFY_BASE_URL` est défini sur
  l'URL publique réelle du service dans `environment_variables`.
- **Publication/abonnement bloqués de manière inattendue :** vérifiez `ingress_settings` (qui doit valoir
  `all` pour le trafic public) et si `enable_iap` a été activé — IAP exige une
  connexion Google et bloque les appels de publication/abonnement non authentifiés, ce qui n'est
  généralement pas souhaitable pour un point de terminaison de notification.
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment conserver `max_instance_count = 1` et
`cpu_always_allocated = true` pour une remise correcte en temps réel).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run
et les images Artifact Registry. Il n'y a aucune base de données Cloud SQL, aucun bucket GCS ni aucun
secret généré automatiquement à nettoyer (ntfy n'en provisionne aucun par défaut). Les ressources
appartenant à **Services_GCP** (le VPC, le registre partagé) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un unique service Cloud Run exécutant ntfy ; aucune base de données ni aucun bucket de stockage |
| 2 — Accéder et vérifier | Manuel | La vérification d'état réussit ; le test rapide de publication/abonnement confirme la remise en temps réel |
| 3 — Exploiter | Manuel | Inspecter les révisions, maintenir le maximum d'instances à 1, mettre à jour la version, gérer les secrets, activer NFS pour la durabilité |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de persistance du cache, d'accès et de build |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
