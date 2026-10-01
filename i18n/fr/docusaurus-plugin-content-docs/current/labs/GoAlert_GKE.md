---
title: "GoAlert sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez GoAlert sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/GoAlert_GKE.md @ 3055034 sha256:ea80be569c8c -->

# GoAlert sur GKE Autopilot — Guide de lab {#goalert-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/GoAlert_GKE)**

## Vue d’ensemble {#overview}

**Durée estimée :** 45–75 minutes

GoAlert est une plateforme open source de planification des astreintes et d’escalade des alertes
d’incident, conçue à l’origine par Target, avec des politiques d’escalade, des rotations/plannings
d’astreinte et l’envoi de notifications sortantes (e-mail, webhook et, en
option, SMS/appels vocaux Twilio). Ce lab vous fait parcourir le cycle de vie opérationnel
complet du module **GoAlert sur GKE Autopilot** sur Google Cloud : le déployer,
y accéder et le vérifier, l’exploiter au quotidien, l’observer, diagnostiquer les problèmes courants, puis
le supprimer.

Le lab porte sur l’exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit GoAlert. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/GoAlert_GKE) — ce
lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu’il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail en cours d’exécution et récupérer les
  identifiants administrateur créés à l’amorçage.
- Effectuer les opérations du jour 2 — inspecter, mettre à l’échelle, mettre à jour et gérer les secrets.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d’exécution les plus courants, y compris
  l’ordre des jobs d’initialisation, dont tout dépend.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Artifact
  Registry et les comptes de service partagés dont dépend ce module). Vous n’avez pas besoin
  de le déployer vous-même au préalable — la plateforme détecte automatiquement s’il
  existe déjà dans le projet cible et, sinon, le provisionne avant ce module
  (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez en tant que Owner du projet les commandes qu’elle affiche, puis **Verify**) et d’attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l’un ni l’autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l’échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement, après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n’entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l’autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **GoAlert (GKE)** dans
   la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s’ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/GoAlert_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Si vous déployez à côté d’une
   instance `GoAlert_CloudRun` dans le même projet, définissez
   `tenant_id = "gke"` (et `"cr"` sur le déploiement Cloud Run) afin que les
   deux variantes n’entrent pas en collision sur les noms de ressources partagées. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu’elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d’un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d’état du
   déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 17) avec ses secrets Secret Manager (mot de passe
   administrateur, clé de chiffrement des données et mot de passe de la base), construit l’image
   de conteneur personnalisée, et exécute la chaîne de jobs d’initialisation de la base en 3 étapes
   (`db-init` → `db-migrate` → `admin-bootstrap`). Un premier déploiement prend généralement
   environ **15 à 25 minutes** — la création de l’instance Cloud SQL représente l’essentiel du temps. Contrairement à la
   sémantique `execute_on_apply` de Cloud Run, sur GKE les pods des Jobs sont planifiés
   immédiatement, quel que soit ce paramètre ; l’ordre correct est garanti par
   le `depends_on_jobs` de chaque job, et non par l’attente de Terraform.

3. Connectez-vous au cluster et repérez l’espace de noms à l’aide de filtres indépendants du nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep goalert | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail s’exécute et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. GoAlert expose un point de terminaison public
   `/health`, sans authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Récupérez les identifiants administrateur créés à l’amorçage. GoAlert n’a **aucun assistant de configuration
   à la première visite** — le seul compte existant est celui créé par le
   job d’initialisation `admin-bootstrap` au moment du déploiement :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~goalert AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

4. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur et connectez-vous avec le nom d’utilisateur
   (`admin` par défaut) et le mot de passe récupéré ci-dessus.

5. **Définissez `public_url`** sur l’IP externe ou le domaine personnalisé, puis appliquez la modification
   via **Update**. Contrairement à la variante Cloud Run, ce module ne
   calcule pas automatiquement d’URL de service — si vous ne le définissez pas, `GOALERT_PUBLIC_URL` se rabat
   sur la valeur propre à GoAlert, `http://localhost:8081`, ce qui casse les rappels OIDC et les
   liens des e-mails de notification sortants. Réserver une IP statique
   (`reserve_static_ip = true`, la valeur par défaut) maintient cette adresse stable d’un
   redéploiement à l’autre.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspecter la charge de travail :**

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettre à l’échelle** en modifiant les paramètres de nombre minimal/maximal d’instances puis en cliquant sur **Update** sur la
   page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la mise à l’échelle est donc une
   modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée à l’application suivante). Conservez `min_instance_count >= 1` : GoAlert exécute en
   continu, dans le même processus, un moteur d’escalade qui doit rester actif pour évaluer
   les plannings et déclencher les vraies alertes.

3. **Mettre à jour la version de l’application** en modifiant le paramètre de version dans la plateforme
   RAD et en l’appliquant via **Update** ; une nouvelle image est construite, une mise à jour
   progressive remplace le pod, et la chaîne de jobs d’initialisation en 3 étapes s’exécute de nouveau (les trois jobs
   sont idempotents et peuvent être relancés sans risque).

4. **Gérer les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~goalert"
   kubectl get jobs -n "$NS"
   ```

5. **Ouvrir une session de base de données** pour l’inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. goalertdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^goalert" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

   Notez que l’utilisateur de base de données par défaut de cette variante est `admin`, et non `goalert` — consultez
   le Guide de configuration au sujet de l’incohérence de nommage entre les variantes CloudRun et
   GKE.

6. **Gérer les plannings d’astreinte et les politiques d’escalade** — des opérations du jour 2 propres à
   GoAlert, effectuées dans l’interface web (Escalation Policies, Schedules,
   Rotations, Services) plutôt que via Terraform ; il s’agit de données applicatives GoAlert,
   et non d’infrastructure.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l’explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Cherchez une véritable ligne « listening and serving HTTP » confirmant que le serveur a bien
   ouvert son port. Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l’utilisation du processeur et de la
   mémoire des pods ainsi que le nombre de redémarrages. Le module peut provisionner un **test de
   disponibilité** (uptime check, lorsqu’il est activé) ; consultez Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous risquez le plus de rencontrer. Il s’agit de
diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de GoAlert.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux. La sonde de démarrage
  est une sonde TCP sur le port du conteneur, avec un délai initial de 30 secondes et jusqu’à 30
  tentatives (pour laisser le temps aux migrations du premier démarrage).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l’instance Cloud SQL est `RUNNABLE` et que
  le sidecar cloud-sql-proxy est en bonne santé. Sur GKE, le point d’entrée se connecte en
  TCP sur l’interface de bouclage (`127.0.0.1`), et non via un socket Unix — vérifiez les valeurs
  `DB_HOST`/`DB_IP` injectées dans le pod si les connexions échouent.
- **Échecs de migration — l’étape dont tout dépend.** Si `admin-bootstrap` échoue avec
  `relation "auth_basic_users" does not exist`, c’est que `db-migrate` ne s’est pas d’abord terminé
  avec succès. Consultez précisément les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-migrate-job-name>
  ```
  N’oubliez pas que sur GKE, `execute_on_apply = false` (s’il est défini sur un job personnalisé)
  n’aurait PAS retardé la planification du pod — seulement l’attente du résultat par Terraform.
  Si l’ordre semble incorrect, vérifiez la chaîne `depends_on_jobs` de chaque job plutôt que de
  supposer que le séquencement au moment de l’application vous a protégé.
- **Erreurs de récupération d’image :** vérifiez que l’image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.
- **Pod en attente / pas d’IP externe :** consultez les événements de `kubectl describe pod` pour repérer des
  problèmes de ressources ou de quotas, et vérifiez que le Service LoadBalancer a une IP
  attribuée.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre (notamment pourquoi `public_url` doit être défini manuellement sur cette variante, et pourquoi
`min_instance_count` doit conserver sa valeur par défaut pour que le moteur d’escalade de GoAlert
fonctionne correctement).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l’icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l’enregistrement du
déploiement est conservé pour l’historique). Si un déploiement est bloqué et que la plateforme RAD ne peut
plus le gérer (par exemple après des modifications manuelles en conflit avec
l’état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — elle retire le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le
déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes et
son espace de noms, la base de données Cloud SQL, les secrets Secret Manager et les images
Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le Cloud
SQL partagé, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 17), des secrets, et exécute la chaîne `db-init` → `db-migrate` → `admin-bootstrap` |
| 2 — Accéder et vérifier | Manuel | Connexion au cluster ; le contrôle de santé réussit sur `/health` ; récupérer les identifiants administrateur créés à l’amorçage et se connecter ; définir `public_url` |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l’échelle, mettre à jour la version, gérer les secrets, accès à la base, gérer plannings/politiques d’escalade |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, d’ordre des migrations, de planification et de récupération d’image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
