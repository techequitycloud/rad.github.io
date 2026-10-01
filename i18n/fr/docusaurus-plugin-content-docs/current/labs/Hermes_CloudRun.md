---
title: "Hermes Agent sur Cloud Run — Guide de lab"
description: "Lab pratique : déployer Hermes Agent sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Hermes_CloudRun.md @ 3055034 sha256:ae645f13adda -->

# Hermes Agent sur Cloud Run — Guide de lab {#hermes-agent-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hermes_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–60 minutes

Hermes Agent est l'agent d'IA personnel auto-hébergé et auto-améliorant de Nous Research —
il apprend des compétences par l'expérience, conserve une mémoire d'une session à l'autre et expose une
API compatible OpenAI ainsi que des connecteurs de messagerie depuis un unique processus de passerelle (gateway).
Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Hermes on
Cloud Run** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler. Comme
Hermes n'a **aucune base de données Cloud SQL**, les déploiements sont nettement plus rapides que pour la plupart des
modules de ce catalogue.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google
Cloud**, et non sur les fonctionnalités du produit Hermes. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Hermes_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Appeler l'API compatible OpenAI de la passerelle avec le jeton bearer généré automatiquement.
- Effectuer les opérations du jour 2 — mettre à jour la version, renouveler les clés et vérifier que
  l'état de l'agent, stocké sur NFS, survit à un redéploiement.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement, en comprenant ce qu'il advient de l'état
  de l'agent.

## Prérequis {#prerequisites}

- **Services_GCP**, avec la VM du serveur NFS (`create_network_filesystem = true`)
  — Hermes stocke l'intégralité de son identité sur le partage NFS partagé, la VM du
  serveur NFS est donc **obligatoire**. Vous n'avez pas besoin de la déployer ni de la configurer
  vous-même au préalable : `create_network_filesystem` est activé par défaut pour chaque
  déploiement automatisé, si bien que le Services_GCP provisionné automatiquement par la plateforme
  satisfait déjà cette exigence. Si vous déployez plutôt Services_GCP manuellement, ne
  désactivez pas ce paramètre. Pour vérifier que la VM du serveur NFS est `RUNNING` après le déploiement :
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  ```
- Un projet Google Cloud avec la **facturation activée**.
- Une **clé API Anthropic** (ou une clé OpenAI) — l'agent ne peut exécuter aucun tour
  sans au moins une clé de fournisseur de modèles.
- **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
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

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Hermes (Cloud Run)** depuis la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et collez
   votre `anthropic_api_key`. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Hermes_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme provisionne le service Cloud Run (une seule instance toujours active —
   `min=1`, `max=1`, CPU toujours alloué), les secrets Secret Manager (votre clé de
   fournisseur ainsi que `API_SERVER_KEY` et le mot de passe du tableau de bord, générés automatiquement), met en miroir
   l'image officielle `nousresearch/hermes-agent` dans Artifact Registry, et
   monte le NFS partagé sur `/opt/data`. Il n'y a **ni instance Cloud SQL, ni
   job d'initialisation de base de données, ni build d'image**, si bien que les premiers déploiements se terminent généralement en
   **10–15 minutes**.

3. Une fois terminé, repérez les ressources avec des filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~hermes" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"

   gcloud secrets list --project="$PROJECT" --filter="name~hermes"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Le serveur d'API compatible OpenAI de la passerelle (port 8642) authentifie chaque
   requête avec le jeton bearer `API_SERVER_KEY` généré automatiquement. Récupérez-le
   dans Secret Manager et appelez l'API :

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~hermes AND name~api-server-key" \
     --format="value(name)" --limit=1)
   KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -H "Authorization: Bearer $KEY" "$SERVICE_URL/v1/models"
   ```

   Une liste de modèles au format JSON confirme que la passerelle est démarrée, que le répertoire d'état NFS
   est initialisé et que la clé API est correctement câblée. Vérifiez aussi que le corps de la réponse
   n'est **pas vide** — un 200 avec un corps de longueur nulle signifie que le point de terminaison de santé
   a été servi par le mauvais processus, et non par la passerelle :

   ```bash
   curl -s -H "Authorization: Bearer $KEY" "$SERVICE_URL/v1/models" | wc -c   # expect a non-zero byte count
   ```

   Une requête non authentifiée doit être rejetée :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/v1/models"   # expect 401/403
   ```

2. Notez que le **tableau de bord web (port 9119) n'est pas joignable sur Cloud Run** —
   Cloud Run n'achemine qu'un seul port d'entrée (8642). Utilisez l'API compatible OpenAI
   (ou le port-forward de la variante GKE) pour un accès interactif. Si vous avez activé
   Telegram (`enable_telegram` + jeton du bot), envoyez un message à votre bot — le connecteur
   interroge en long-polling vers l'extérieur, il fonctionne donc sans webhook ni URL de rappel publique.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; l'instance unique reste chaude car le CPU est toujours alloué) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme
   RAD et en l'appliquant via **Update** ; le miroir recopie le tag si le
   digest a changé et une nouvelle révision est déployée. N'augmentez **pas**
   `max_instance_count` — une validation au moment du plan rejette toute valeur supérieure à 1
   (SQLite n'accepte qu'un seul processus d'écriture).

3. **Renouvelez les clés.** Fournissez une nouvelle valeur pour `api_server_key` (ou
   `anthropic_api_key`) dans la plateforme RAD et cliquez sur **Update** — une nouvelle version Secret
   Manager est créée et le service redémarre avec elle. Laisser un
   identifiant vide lors d'une mise à jour conserve la version stockée :

   ```bash
   gcloud secrets versions list "$API_SECRET" --project="$PROJECT"
   ```

4. **Vérifiez que l'état survit à un redéploiement.** L'identité de l'agent (configuration SQLite,
   sessions, compétences apprises, mémoires) réside dans `/opt/data` sur le NFS partagé,
   et non dans le conteneur. Après la mise à jour de version de l'étape 2, vérifiez que le même
   `API_SERVER_KEY` fonctionne toujours et que l'agent se souvient toujours de sa configuration.
   Vous pouvez aussi inspecter directement les fichiers d'état depuis la VM du serveur NFS :

   ```bash
   NFS_VM=$(gcloud compute instances list --project="$PROJECT" \
     --filter="name~nfs" --format="value(name)" --limit=1)
   NFS_ZONE=$(gcloud compute instances list --project="$PROJECT" \
     --filter="name~nfs" --format="value(zone)" --limit=1)
   gcloud compute ssh "$NFS_VM" --zone="$NFS_ZONE" --project="$PROJECT" \
     --command='ls -la /mnt/nfs* 2>/dev/null || ls -la /export 2>/dev/null'
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis la CLI ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Recherchez les lignes d'initialisation de s6-overlay et les messages de démarrage de la passerelle/du serveur d'API.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez
   le nombre d'instances (attendez-vous à une valeur constante de 1 — ce module est volontairement toujours actif),
   l'utilisation du CPU / de la mémoire et la latence des requêtes. Le test de disponibilité est désactivé par
   défaut (le serveur d'API exige une authentification), les alertes reposent donc sur des métriques — consultez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Hermes.

- **VM du serveur NFS non `RUNNING` → échec du déploiement ou du démarrage.** Si la VM NFS partagée
  est arrêtée ou en rupture de capacité (`ZONE_RESOURCE_POOL_EXHAUSTED` — un problème de capacité,
  et non de quota), la découverte ne trouve aucun serveur et le montage échoue, ou bien le module
  tente de créer un NFS intégré et entre en collision avec des ressources existantes
  (`409 already exists`). Vérifiez d'abord la VM, et attendez qu'elle soit `RUNNING` avant de
  redéployer :
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  ```
- **Clé de fournisseur de modèles manquante → l'agent ne peut exécuter aucun tour.** Le service peut être
  en bonne santé (la sonde TCP réussit) alors que chaque tour de l'agent échoue. Recherchez dans les journaux
  des erreurs d'authentification provenant du fournisseur, et vérifiez que le secret Anthropic a
  une version :
  ```bash
  gcloud secrets versions list "$(gcloud secrets list --project="$PROJECT" \
    --filter='name~hermes AND name~anthropic' --format='value(name)' --limit=1)" \
    --project="$PROJECT"
  ```
  Une erreur `"Secret was not found"` au moment du déploiement signifie que le conteneur du secret existe
  mais n'a aucune version — fournissez `anthropic_api_key` et effectuez une mise à jour.
- **Révision en mauvaise santé / déploiement bloqué :** inspectez la dernière révision et ses
  journaux. La sonde de démarrage par défaut est en TCP et la sonde de vivacité (liveness) est **désactivée par
  défaut** (Cloud Run ne prend pas en charge les sondes de vivacité TCP) ; si quelqu'un a basculé
  la sonde de démarrage vers un chemin HTTP sur le serveur d'API authentifié, elle renvoie 401 indéfiniment et
  le déploiement reste bloqué — revenez au TCP. De même, n'activez la sonde de vivacité
  avec un chemin HTTP qu'après avoir vérifié que le point de terminaison est sans authentification — les sondes s'exécutent
  sans authentification, si bien qu'un point de terminaison renvoyant 401/403 tue des instances saines.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Échecs d'authentification du connecteur (Telegram) :** un jeton de bot erroné ou révoqué se traduit par
  des 401 répétés de `api.telegram.org` dans les journaux. Mettez à jour `telegram_bot_token`
  dans la plateforme et redéployez ; le connecteur fonctionne en long-polling, aucun enregistrement
  de webhook n'est donc en jeu.
- **Erreurs 403 / d'autorisation :** vérifiez les rôles IAM du compte de service d'exécution
  (en particulier Secret Manager accessor).

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment les règles essentielles selon lesquelles `max_instance_count`
reste à 1 et `enable_nfs` reste à true).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement
est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD
ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Cela supprime tout ce que le module a créé — le service Cloud Run,
les secrets Secret Manager et les images mises en miroir dans Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le serveur NFS, le registre) sont gérées séparément et
ne sont pas supprimées ici — en particulier, **le répertoire d'état de l'agent sur l'export NFS
partagé est conservé**, si bien qu'un redéploiement ultérieur sur le même tenant se rattache à
l'identité existante de l'agent.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module provisionne le service Cloud Run toujours actif, les secrets Secret Manager, le miroir d'image et le montage NFS — ni Cloud SQL, ni build |
| 2 — Accéder et vérifier | Manuel | L'appel authentifié à `/v1/models` réussit avec le jeton bearer de Secret Manager ; l'appel non authentifié est rejeté |
| 3 — Exploiter | Manuel | Mettre à jour la version, renouveler les clés, vérifier que l'état stocké sur NFS survit à un redéploiement |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner le profil à instance unique constante et les métriques |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de disponibilité NFS, de clé de fournisseur, de sonde, de connecteur et d'IAM |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime les ressources du module ; l'état de l'agent sur le NFS partagé est conservé |
