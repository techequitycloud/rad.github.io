---
title: "SearXNG sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez SearXNG sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/SearXNG_CloudRun.md @ 3055034 sha256:2fc117effe42 -->

# SearXNG sur Cloud Run — Guide de lab {#searxng-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/SearXNG_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30 à 60 minutes

SearXNG est un métamoteur de recherche auto-hébergé et respectueux de la vie privée, qui agrège
les résultats de plus de 70 services de recherche sans pister les utilisateurs ni afficher de publicités. Ce lab
vous fait parcourir tout le cycle de vie opérationnel du module **SearXNG on Cloud Run**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités de SearXNG. Pour la liste complète des
services provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/SearXNG_CloudRun)
— ce lab ne duplique volontairement pas ce détail afin de rester exact dans
le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Accéder au service en cours d'exécution et le vérifier.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets.
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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **SearXNG (Cloud Run)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/SearXNG_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run, génère la clé de session `SEARXNG_SECRET`
   dans Secret Manager, et construit ou met en miroir l'image de conteneur. Comme
   SearXNG est entièrement sans état (ni base de données, ni job d'initialisation), les premiers déploiements se terminent
   en quelques minutes.

3. Une fois l'opération terminée, repérez les ressources avec des filtres indépendants des noms (afin que
   les commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~searxng" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service est sain :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "${SERVICE_URL}/healthz"
   ```

   Résultat attendu : HTTP `200`. SearXNG expose son point de terminaison de santé intégré sur `/healthz`.
   Si vous obtenez `503`, une nouvelle instance est en cours de démarrage à froid — patientez quelques secondes et
   réessayez. Les démarrages à froid sont rapides (moins de 5 secondes), car il n'y a ni connexion à une base
   de données ni migration de schéma au démarrage.

2. Ouvrez `$SERVICE_URL` dans un navigateur pour accéder à l'interface de recherche de SearXNG.
   Aucun identifiant administrateur n'est requis — SearXNG n'a pas de connexion administrateur.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente qui est saine) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max dans la plateforme RAD et
   en appliquant la modification via **Update** — le module possède la spécification du service, donc la mise à l'échelle est une
   modification de configuration, et non une modification manuelle via `gcloud` (une modification manuelle serait annulée lors de la
   prochaine application). Notez que `min_instance_count` est fixé à 0 ; le service est réduit
   à zéro lorsqu'il est inactif.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans l'interface
   RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une nouvelle révision est déployée.

4. **Gérez les secrets :**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~searxng"
   ```

   `SEARXNG_SECRET` est la clé de session générée automatiquement et injectée à l'exécution.
   Elle est générée une seule fois et partagée entre toutes les instances en cours d'exécution. La renouveler
   invalide toutes les sessions utilisateur actives — évitez de la renouveler sauf nécessité.

5. **Inspectez les jobs Cloud Run** (SearXNG ne requiert par défaut aucun job d'initialisation ni job planifié,
   mais les tâches cron que vous configurez apparaissent ici) :

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le
   nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de
   mise à l'échelle) et l'utilisation CPU / mémoire. Le module provisionne également un
   **test de disponibilité** (lorsqu'il est activé) ; vérifiez qu'il est au vert sous
   Monitoring → Uptime checks, et examinez Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de SearXNG.

- **Révision non saine / le service ne répond pas :** examinez la dernière révision et
  ses journaux à la recherche d'erreurs de démarrage, et vérifiez que les variables d'environnement et les secrets ont été résolus.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Résultats de recherche vides / moteurs en amont injoignables :** SearXNG doit pouvoir joindre
  des moteurs de recherche externes via Internet. Si `vpc_egress_setting` vaut
  `PRIVATE_RANGES_ONLY` et que Cloud NAT n'est pas configuré, le trafic Internet sortant
  est bloqué. Passez à `ALL_TRAFFIC` ou ajoutez une passerelle Cloud NAT.
- **`SEARXNG_SECRET` non résolu :** vérifiez que le secret existe et que le compte de service
  d'exécution dispose de `secretmanager.versions.access`.
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~searxng"
  ```
- **Échec du build de l'image :** consultez l'historique de Cloud Build pour lire le journal du build en échec.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le service Cloud Run,
les secrets Secret Manager et les images d'Artifact Registry. SearXNG étant sans état,
il n'y a ni base de données ni stockage persistant à supprimer. Les ressources appartenant à
**Services_GCP** (le VPC, le registre partagé) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne Cloud Run, génère SEARXNG_SECRET et met l'image en miroir |
| 2 — Accéder et vérifier | Manuel | Le contrôle d'état réussit sur `/healthz` ; l'interface de recherche se charge |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, mettre à jour la version, gérer les secrets |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de trafic sortant, de secret, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
