---
title: "Element sur Cloud Run — Guide de lab"
description: "Lab pratique : déployez Element sur Cloud Run dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Element_CloudRun.md @ 3055034 sha256:999289e7014d -->

# Element sur Cloud Run — Guide de lab {#element-on-cloud-run--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Element_CloudRun)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–60 minutes

Element est le principal client web Matrix open source — une application de messagerie auto-hébergée,
chiffrée de bout en bout, qui s'exécute comme une application monopage statique et
se connecte au homeserver Matrix que vous indiquez. Ce lab vous fait parcourir l'intégralité du
cycle de vie opérationnel du module **Element sur Cloud Run** sur Google Cloud : le déployer,
le faire pointer vers un homeserver, le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer
les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module Cloud Run et de la plateforme Google Cloud**,
et non sur les fonctionnalités du produit Element. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Element_CloudRun) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous serez en mesure de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Faire pointer Element vers un homeserver Matrix et vérifier le service en cours d'exécution.
- Effectuer les opérations du jour 2 (day-2) — inspecter, mettre à l'échelle, mettre à jour la version et changer
  le homeserver cible.
- Observer le service avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, Artifact Registry et les comptes de service
  partagés dont dépend ce module). Vous n'avez pas besoin de le déployer vous-même
  au préalable — la plateforme détecte automatiquement s'il existe déjà dans le
  projet cible et, sinon, le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- La **gcloud CLI** authentifiée : `gcloud auth login` et `gcloud auth application-default login`.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- Un **homeserver Matrix** auquel se connecter — soit le serveur public `matrix.org` (la
  valeur par défaut), soit votre propre instance Synapse/Dendrite.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Dans la plateforme RAD, ouvrez **Solutions → Solution Catalog → RAD modules**, puis ouvrez **Element (Cloud Run)** dans la liste **Platform Modules**, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id`, et renseignez
   `homeserver_url` / `homeserver_name` avec votre homeserver Matrix (ou laissez-les vides
   pour utiliser le serveur public `matrix.org`). Passez en revue les autres paramètres — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Element_CloudRun)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement
   avec les journaux en temps réel.

2. La plateforme build l'image Element personnalisée (une fine couche au-dessus de
   `vectorim/element-web` qui génère `config.json` au démarrage), la pousse dans
   Artifact Registry et provisionne le service Cloud Run. Il n'y a **ni base de données,
   ni secret, ni bucket de stockage** à créer : les premiers déploiements sont donc rapides —
   généralement **5–10 minutes**, l'essentiel étant consacré au build du conteneur.

3. Une fois l'opération terminée, découvrez les ressources à l'aide de filtres indépendants des noms (afin que les
   commandes continuent de fonctionner quel que soit le suffixe du déploiement) :

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~element" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le service répond et que son `config.json` d'exécution pointe vers votre
   homeserver :

   ```bash
   curl -s "$SERVICE_URL/config.json" | grep -E 'base_url|server_name'   # your homeserver
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"              # expect 200
   ```

2. Ouvrez `$SERVICE_URL` dans un navigateur. Element charge son écran de connexion affichant le
   homeserver configuré. Connectez-vous avec un compte sur ce homeserver (ou créez-en un,
   si le homeserver le permet) — l'authentification a lieu **entre votre navigateur et
   le homeserver**, et non dans le conteneur Cloud Run.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez le service et ses révisions** (chaque déploiement crée une révision
   immuable ; le trafic bascule vers la plus récente en bonne santé) :

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Ajustez le plafond de mise à l'échelle** en modifiant `max_instance_count` et en cliquant sur **Update** sur
   la page de détails du déploiement — le module est propriétaire de la spécification du service : la mise à l'échelle est donc une
   modification de configuration, et non une modification manuelle avec `gcloud` (une modification manuelle serait annulée
   lors de l'application suivante). **`min_instance_count` n'est pas un levier utilisable pour ce module :**
   `element.tf` le fixe en dur à `0` à la fois dans l'appel au module Foundation et dans la surcharge
   de configuration ; `var.min_instance_count` n'est donc jamais transmis au service déployé —
   l'augmenter via la plateforme n'a aucun effet. Element étant sans état, c'est voulu :
   l'application monopage statique est toujours gratuite au repos, quelle que soit la valeur affichée par le paramètre.

3. **Changez le homeserver cible** en modifiant `homeserver_url` / `homeserver_name` dans la
   plateforme RAD et en cliquant sur **Update** — le point d'entrée réécrit `config.json` dans les
   conteneurs de la nouvelle révision. Aucun nouveau build de l'image n'est nécessaire.

4. **Mettez à jour la version de l'application** en modifiant le paramètre de version et en l'appliquant via
   **Update** ; une nouvelle image est buildée et une nouvelle révision est déployée. Vérifiez le digest de l'image
   de la révision déployée si une modification semble ne pas avoir été prise en compte.

5. **Vérifiez le homeserver injecté dans la révision en cours d'exécution :**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)'
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — journaux d'accès et d'erreurs nginx, depuis la CLI ou le Logs Explorer :

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Filtre du Logs Explorer :
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Surveillance** — ouvrez le tableau de bord Cloud Run du service et examinez le nombre
   de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances (comportement de mise à l'échelle) et l'utilisation du CPU et de
   la mémoire. Lorsque le point de terminaison est public, le module provisionne également un
   **test de disponibilité** (uptime check) ; vérifiez qu'il est au vert sous Monitoring → Uptime checks, et examinez
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version d'Element à l'autre.

- **Révision en mauvaise santé / le service ne répond pas :** inspectez la dernière révision et ses
  journaux pour repérer les erreurs de démarrage de nginx. La sonde de démarrage cible `/`, à laquelle nginx répond
  dès qu'il est lié au port 80.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **L'écran de connexion affiche le mauvais homeserver :** le point d'entrée écrit `config.json`
  à partir de `HOMESERVER_URL` / `HOMESERVER_NAME` ; vérifiez les variables d'environnement de la révision en cours d'exécution
  (tâche 3, étape 5) et changez la cible via **Update**.
- **Les utilisateurs peuvent charger l'interface mais pas se connecter :** le homeserver est injoignable ou
  incorrect — vérifiez que `homeserver_url` se résout et sert l'API client-serveur Matrix
  (`curl -s <homeserver_url>/_matrix/client/versions`).
- **Échec du build de l'image :** consultez l'historique Cloud Build pour lire le journal du build en échec ; une
  étiquette `latest` définie à la main sur un ARG de build brut en est une cause fréquente (`MANIFEST_UNKNOWN`).
- **Erreurs 403 / d'autorisation lors du déploiement :** vérifiez les rôles IAM du compte de service
  d'exécution.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec l'état
Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD
**sans** détruire les ressources cloud. Cela supprime tout ce que le module a créé
— le service Cloud Run et ses images Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le registre) sont gérées séparément et ne sont pas supprimées ici.

Element étant sans état, il n'y a ni base de données, ni secret, ni bucket de stockage à
nettoyer — le démantèlement est propre et rapide.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module build l'image Element et provisionne le service Cloud Run (ni base de données, ni secret, ni stockage) |
| 2 — Accéder et vérifier | Manuel | `config.json` pointe vers votre homeserver ; connexion via le flux navigateur-vers-homeserver |
| 3 — Exploiter | Manuel | Inspecter les révisions, mettre à l'échelle, changer le homeserver cible, mettre à jour la version |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de révision, de configuration du homeserver, de connexion, de build et d'IAM |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
