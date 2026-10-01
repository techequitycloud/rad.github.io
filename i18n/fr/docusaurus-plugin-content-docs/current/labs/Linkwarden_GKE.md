---
title: "Linkwarden sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Linkwarden sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Linkwarden_GKE.md @ 3055034 sha256:8fdf6a76e3ab -->

# Linkwarden sur GKE Autopilot — Guide de lab {#linkwarden-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Linkwarden_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

Linkwarden est un gestionnaire de favoris open source et auto-hébergé, doté de l'archivage de pages
complètes (captures d'écran, PDF et instantanés « monolith » en fichier unique via un Chrome headless
intégré). Ce lab vous fait parcourir tout le cycle de vie opérationnel du
module **Linkwarden on GKE Autopilot** sur Google Cloud : le déployer, y accéder
et le vérifier, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et
le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de Linkwarden. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Linkwarden_GKE) —
ce lab ne duplique volontairement pas ce détail afin de rester exact dans le
temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il
  provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et
  le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

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
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que Owner du projet, puis **Verify**) et d'accorder le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne requiert ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chacune des tâches ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Linkwarden
   (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Linkwarden_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page
   d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot,
   provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses secrets
   Secret Manager (`NEXTAUTH_SECRET` et le mot de passe de la base), un bucket Cloud Storage
   monté sur `/data/data` pour le contenu archivé, construit l'image de conteneur
   personnalisée (une fine enveloppe autour de `ghcr.io/linkwarden/linkwarden`)
   et exécute un job ponctuel d'initialisation de la base de données. Les premiers déploiements prennent
   environ **20 à 35 minutes** (la création de Cloud SQL représente l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants
   des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep linkwarden | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service répond (Linkwarden ne dispose d'aucun point de terminaison de santé dédié
   confirmé ; la page racine est donc le meilleur indicateur) :

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "http://${EXTERNAL_IP}"
   # expect 200 and a non-trivial byte size (a rendered page, not an empty body)
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Lors de la première visite, Linkwarden affiche
   la page d'inscription — aucun identifiant administrateur pré-provisionné n'existe dans Secret
   Manager. Inscrivez le premier compte ; il devient automatiquement le
   propriétaire de l'instance.

4. **Vérifiez l'archivage de bout en bout (le véritable test avec état).** Connectez-vous, ajoutez un
   favori (n'importe quelle URL publique) et attendez 10 à 30 secondes que le worker d'archivage
   en arrière-plan le traite. Actualisez la vue détaillée du lien et vérifiez
   qu'une capture d'écran/un aperçu a été généré — cela prouve que l'écriture en base, le
   worker en arrière-plan, le Chrome headless et le montage de stockage adossé à GCS sont
   tous correctement raccordés.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement Kubernetes et les pods :

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres d'instances min/max et en cliquant sur **Update**
   sur la page de détails du déploiement — le module possède la spécification de la charge de travail, donc
   la mise à l'échelle est une modification de configuration, et non un `kubectl scale` manuel (une modification
   manuelle serait annulée lors de la prochaine application). Conservez `min_instance_count >= 1`
   — GKE ne permet pas la réduction à zéro, et le worker d'archivage en arrière-plan intégré au conteneur
   doit continuer à s'exécuter. L'affinité de session (`ClientIP`) est définie par
   défaut pour maintenir la stabilité des cookies de session NextAuth.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la
   plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une
   mise à jour progressive remplace les pods. Linkwarden publie un véritable tag `latest`
   en amont, si bien que `latest` suit la version amont réelle.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~linkwarden"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. linkwardendemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^linkwarden" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU
   et mémoire des pods (surveillez les pics pendant les lots du worker d'archivage),
   le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner un
   **test de disponibilité** (lorsqu'il est activé) ; consultez Monitoring → Uptime checks et
   Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Linkwarden.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de
  démarrage cible `/` par défaut, avec une fenêtre généreuse pour le démarrage à froid de Next.js et
  l'initialisation du Chrome headless/Playwright ; un échec de connexion à
  PostgreSQL empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est
  `RUNNABLE`, que le secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que le
  job d'initialisation s'est terminé. Sur GKE, le `DATABASE_URL` de Linkwarden se connecte via le
  bouclage (`127.0.0.1`) du sidecar cloud-sql-proxy avec
  `sslmode=disable` — vérifiez que le conteneur sidecar du pod est sain si
  les connexions échouent.
- **L'archivage ne se termine jamais / les liens restent sans aperçu :** vérifiez d'abord que le
  pod lui-même est `Ready` (tâche 2). Si c'est le cas, utilisez `kubectl logs` pour rechercher un
  échec de lancement du Chrome headless/Playwright dans la sortie du worker. Contrairement au
  bac à sable gVisor de Cloud Run, GKE s'exécute sur de véritables nœuds Linux ; ce type
  d'incompatibilité avec le bac à sable de la plateforme est donc bien moins probable ici — un véritable
  échec d'archivage relève plus probablement d'une contrainte de mémoire (`container_resources.memory_limit`
  trop faible) ou d'une mauvaise configuration de `disable_browser`.
- **Échec du job d'initialisation :** examinez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer s'est vu
  attribuer une IP (`reserve_static_ip = true` par défaut, donc l'IP devrait rester
  stable entre les redéploiements).
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que
  le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les
pièges propres à chaque paramètre (notamment la règle essentielle : ne jamais renouveler
`NEXTAUTH_SECRET` après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en
conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). La suppression retire tout ce que le module a créé —
la charge de travail Kubernetes et l'espace de noms, la base de données Cloud SQL, les secrets
Secret Manager, les buckets GCS et les images d'Artifact Registry. Les ressources appartenant à
**Services_GCP** (le VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont
gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets et le bucket de stockage GCS, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le service répond ; inscrire le premier compte (qui devient propriétaire) ; vérifier que l'archivage aboutit de bout en bout |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version, gérer les secrets/le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, d'archivage, de job d'initialisation, de planification et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
