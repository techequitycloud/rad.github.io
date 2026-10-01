---
title: "Gatus sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Gatus sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/Gatus_CloudRun.md @ 3055034 sha256:9ee84bb5087e -->

# Gatus sur Cloud Run — Guide de lab {#gatus-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gatus_CloudRun)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Gatus est une page de statut et un moniteur de contrôles de santé open source, pensé pour les développeurs :
il interroge des points de terminaison HTTP, TCP, DNS et autres selon des planifications indépendantes,
évalue des conditions simples de réussite ou d’échec, et sert une page de statut publique en direct ainsi que
des alertes — sans base de données externe. Ce lab vous fait parcourir le cycle de vie opérationnel complet
du module **Gatus sur Cloud Run** sur Google Cloud : le déployer,
y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants,
puis le supprimer.

Le lab porte sur l’exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Gatus. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Gatus_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Accéder au service en cours d’exécution et le vérifier, notamment en consultant la page de statut en direct.
- Effectuer les opérations du jour 2 — inspecter, évaluer la mise à l’échelle, mettre à jour et gérer
  les secrets.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service partagés
  dont dépend ce module). Vous n’avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s’il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
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
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Gatus (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et passez en revue
   les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Gatus_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne un unique service Cloud Run v2 exécutant le binaire Go de Gatus
   et construit l’image de conteneur (qui intègre un `config.yaml` par défaut
   avec un exemple de contrôle HTTP). Aucune base de données, aucun cache ni aucun bucket de stockage d’objets n’est
   provisionné — le stockage d’historique facultatif de Gatus est un fichier SQLite local. Il n’y a pas de
   job d’initialisation de base de données à attendre ; un premier déploiement est donc généralement bien
   plus rapide qu’un module adossé à une base de données (environ **5 à 10 minutes**, essentiellement consacrées au
   build de l’image).

3. Une fois terminé, repérez le service à l’aide d’un filtre indépendant du nom (afin que la
   commande continue de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gatus" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est en bonne santé. Le point de terminaison de santé de Gatus répond dès que le
   serveur se lie à son port — il n’y a aucune dépendance de base de données à attendre :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health"   # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur pour afficher la page de statut en direct — elle montre le
   contrôle intégré `example` et son historique de disponibilité à mesure que les contrôles s’accumulent.

3. Par défaut, Gatus est livré **sans authentification** sur sa page de statut — toute personne
   disposant de l’URL peut la consulter. Il n’y a pas de compte administrateur à créer. Si la page doit
   lister des noms de points de terminaison sensibles, modifiez le bloc `security` de `modules/Gatus_Common/scripts/config.yaml`
   (authentification basique ou OIDC) et redéployez — cela exige un nouveau build,
   et non un paramètre d’exécution.

4. Gatus ne dispose **d’aucune API ni interface d’exécution pour ajouter des points de terminaison à surveiller**. Pour surveiller un
   point de terminaison réel à la place de l’exemple intégré (ou en plus de celui-ci), modifiez la liste
   `endpoints` dans `modules/Gatus_Common/scripts/config.yaml` et redéployez.

---

## Tâche 3 — Exploiter et maintenir en fonctionnement (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ne dépassez pas une instance.** `max_instance_count` vaut `1` par défaut et
   doit le rester — la boucle d’interrogation (watchdog) de Gatus n’a aucune coordination partagée
   entre instances ; une mise à l’échelle horizontale amènerait donc chaque instance à interroger indépendamment
   chaque point de terminaison et à dupliquer les notifications d’alerte. Toute modification du nombre minimal ou maximal
   d’instances se fait depuis la page de détails du déploiement de la plateforme RAD et s’applique via
   **Update**, et non par une modification manuelle avec `gcloud` (qui serait annulée lors du prochain
   apply).

3. **Mettez à jour la version de l’application** en modifiant le paramètre de version dans la plateforme
   RAD et en l’appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision
   est déployée. En production, fixez explicitement une version `v5.x.y` plutôt que de vous fier à
   `latest`.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gatus"
   ```

   Gatus ne génère aucun secret propre au moment du déploiement — cette liste n’est
   remplie que si vous avez fourni des entrées via `secret_environment_variables`.

5. **L’historique persistant n’est volontairement PAS la valeur par défaut sur Cloud Run.** Gatus
   impose le mode de journalisation SQLite WAL pour son stockage d’historique, et la propre
   documentation de SQLite indique que WAL n’est pas pris en charge sur les systèmes de fichiers réseau — `enable_nfs`
   présente donc ici un risque réel de corruption. Si un historique durable des contrôles compte pour vous, déployez plutôt
   `Gatus_GKE` avec `stateful_pvc_enabled = true` (un véritable périphérique bloc) ;
   Cloud Run n’offre aucune option équivalente.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Gatus journalise le résultat de chaque contrôle de point de terminaison (réussite/échec, durée) au fil de l’exécution —
   utile pour confirmer qu’un point de terminaison nouvellement ajouté est bien interrogé.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre de requêtes,
   la latence des requêtes, le nombre d’instances et l’utilisation du CPU et de la mémoire. Comme
   `cpu_always_allocated = true` par défaut, attendez-vous à une consommation CPU de base constante, même à
   faible trafic — c’est nécessaire pour maintenir la boucle d’interrogation (watchdog) en marche, et non une
   erreur de configuration. Si un **test de disponibilité** (uptime check) Cloud Monitoring est activé, vérifiez qu’il
   est au vert sous Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas d’une version de Gatus à l’autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux à la recherche d’erreurs de démarrage. Les sondes de démarrage et de vivacité (liveness) ciblent toutes deux `/health`,
  qui devrait renvoyer `200` quelques secondes après le démarrage — Gatus n’a aucune base de données à attendre ;
  une sonde lente ou en échec indique donc généralement un problème de build du conteneur ou de configuration
  plutôt qu’une dépendance en aval.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **L’historique des contrôles « disparaît » après un redéploiement :** c’est le comportement attendu avec le
  stockage éphémère par défaut — chaque redémarrage ou redéploiement réinitialise l’historique par conception
  (les points de terminaison configurés ne sont pas affectés ; seuls leurs résultats historiques et
  pourcentages de disponibilité sont réinitialisés). Voir l’étape 5 de la tâche 3 pour les options d’historique durable et leurs compromis.
- **Un point de terminaison nouvellement ajouté n’est pas contrôlé :** vérifiez que vous avez modifié
  `modules/Gatus_Common/scripts/config.yaml` et redéployé — Gatus n’a aucune API d’exécution
  pour ajouter des contrôles ; un point de terminaison ajouté ailleurs n’a donc aucun effet.
- **La page de statut est inaccessible ou bloquée de façon inattendue :** vérifiez `ingress_settings`
  (doit valoir `all` pour le trafic public) et si `enable_iap` a été activé — IAP
  exige une connexion Google et bloque la consultation non authentifiée, ce qui n’est généralement pas
  ce que l’on attend d’une page de statut publique.
- **Le build de l’image a échoué :** consultez l’historique Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d’autorisation :** vérifiez les rôles IAM du compte de service d’exécution.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment garder `max_instance_count = 1` et
`cpu_always_allocated = true` pour une exécution correcte des contrôles planifiés, ainsi que la
mise en garde sur la persistance SQLite WAL).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run
et les images Artifact Registry. Il n’y a ni base de données Cloud SQL, ni bucket GCS, ni
secret généré automatiquement à nettoyer (Gatus n’en provisionne aucun par défaut). Les ressources
appartenant à **Services_GCP** (le VPC, le registre partagé) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne un unique service Cloud Run exécutant Gatus ; aucune base de données ni aucun bucket de stockage |
| 2 — Accéder et vérifier | Manuel | Le contrôle de santé réussit ; la page de statut en direct s’affiche avec l’exemple de contrôle intégré |
| 3 — Exploiter | Manuel | Inspecter les révisions, garder le maximum d’instances à 1, mettre à jour la version, gérer les secrets, comprendre le compromis sur la persistance |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de modification de configuration, d’accès et de build |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module |
