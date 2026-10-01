---
title: "Dolibarr sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Dolibarr sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Dolibarr_GKE.md @ 3055034 sha256:77ff2af95fe7 -->

# Dolibarr sur GKE Autopilot — Guide de lab {#dolibarr-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Dolibarr_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Dolibarr est une suite ERP et CRM libre et open source couvrant les clients et prospects,
les devis, les commandes, les factures, les produits et stocks, les RH, les projets et la comptabilité. Ce
lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Dolibarr sur GKE
Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au
quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Dolibarr. Pour la liste complète des services provisionnés et
de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Dolibarr_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Cloud
  Filestore (NFS), Artifact Registry et les comptes de service partagés dont dépend
  ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon,
  le provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- La **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes qu'elle affiche en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Dolibarr (GKE)** dans la liste **Platform Modules** pour lancer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez `project_id` et passez en revue les
   paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Dolibarr_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (MySQL 8.0) avec ses secrets Secret Manager
   (`DOLI_ADMIN_PASSWORD`, `DOLI_INSTANCE_UNIQUE_ID` et le mot de passe de la base), un
   partage Cloud Filestore (NFS) monté sur `/var/lib/dolibarr`, un bucket Cloud Storage
   `dolibarr-documents`, build l'image du conteneur et exécute un job ponctuel
   d'initialisation de la base de données. L'installateur propre à Dolibarr crée ensuite le schéma au
   premier démarrage du pod (`DOLI_INSTALL_AUTO = 1`) — il n'y a pas de job de migration distinct.
   Les premiers déploiements prennent environ **20–35 minutes** (la création de Cloud SQL et de Filestore
   en représente l'essentiel).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep dolibarr | head -1 | cut -d/ -f2)
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

2. Vérifiez que le service est en bonne santé. La sonde de démarrage est une sonde **TCP** sur le port 80 et la
   sonde de vivacité (liveness) est une sonde **HTTP `GET /`** (la page de connexion renvoie 200 sans authentification).
   Prévoyez plusieurs minutes au premier démarrage pour que l'installateur de Dolibarr s'exécute :

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Récupérez le mot de passe super-administrateur généré automatiquement avant votre première connexion :

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~dolibarr AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Connectez-vous sur `http://${EXTERNAL_IP}` avec le nom d'utilisateur `admin` (la valeur par défaut de
   `DOLI_ADMIN_LOGIN`) et le mot de passe ci-dessus.

4. Définissez `DOLI_URL_ROOT` maintenant que l'IP externe est connue, afin que les liens absolus et la
   redirection de connexion se résolvent correctement — il n'est pas prédéfini sur GKE. Ajoutez-le soit à
   `environment_variables` dans la plateforme RAD puis cliquez sur **Update**, soit corrigez
   directement le Deployment en cours d'exécution :

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl patch deploy "$SVC" -n "$NS" \
     -p '{"spec":{"template":{"spec":{"containers":[{"name":"dolibarr","env":[
       {"name":"DOLI_URL_ROOT","value":"http://'"$EXTERNAL_IP"'"}]}]}}}}'
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — Deployment, pods, PVC (adossé à Filestore) et événements :

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur la page de détails du déploiement —
   le module est propriétaire de la spécification de la charge de travail : la mise à l'échelle est donc une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply). Conservez
   `max_instance_count = 1` sauf si vous avez vérifié le comportement de Dolibarr en matière de sessions partagées et de
   verrous NFS avec plusieurs pods ; la charge de travail utilise la stratégie de mise à jour `Recreate`
   précisément parce qu'elle repose sur NFS (une mise à jour progressive ferait tourner deux
   pods sur le même volume NFS et la même base, et provoquerait un interblocage).

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est buildée et le pod est recréé, exécutant
   au démarrage les étapes de mise à niveau propres à Dolibarr.

4. **Gérez les secrets, le stockage et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~dolibarr"
   gcloud storage buckets list --project="$PROJECT" --filter="name~dolibarr-documents"
   gcloud filestore instances list --project="$PROJECT"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. dolibarrdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^dolibarr" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la
   mémoire des pods, le nombre de redémarrages et les métriques de requêtes, ainsi que les tableaux de bord des instances Cloud SQL et
   Filestore. Le module peut provisionner un **test de disponibilité** (uptime check) (lorsqu'il est
   activé) ; examinez Monitoring → Uptime checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version de Dolibarr à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité
  cible `GET /` ; un échec de connexion à Cloud SQL (via le sidecar Auth Proxy sur
  `127.0.0.1:3306`) empêchera le pod de passer à l'état Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep DOLI_DB
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`, que le
  secret du mot de passe de la base a bien été matérialisé dans l'espace de noms et que le job `db-init` s'est terminé
  (il peut être relancé sans risque ; `max_retries = 3`).
- **Échec du job d'initialisation :** inspectez le job et les journaux de son pod :
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **L'installateur tourne en boucle ou affiche des erreurs de base de données au premier démarrage :** vérifiez que le job `db-init` s'est exécuté
  jusqu'au bout avant la première visite dans le navigateur — `DOLI_INSTALL_AUTO = 1` a besoin d'une
  base de données vide et joignable pour y créer le schéma.
- **Les documents/PDF disparaissent après un redémarrage du pod :** vérifiez que `enable_nfs = true` et
  que le PVC est lié au partage Filestore sur `/var/lib/dolibarr` — un volume NFS désactivé
  ou non monté rend les fichiers téléversés éphémères.
  ```bash
  kubectl get pvc -n "$NS"
  gcloud filestore instances list --project="$PROJECT"
  ```
- **Déploiement bloqué lors d'une mise à jour (`1 old replicas are pending termination`) :** comportement
  attendu de la stratégie `Recreate` — l'ancien pod doit se terminer complètement avant que le
  nouveau ne démarre ; une brève interruption pendant les mises à jour est donc normale, et non un blocage. Si cela
  persiste bien au-delà d'une minute, recherchez un verrou NFS/base de données resté bloqué par l'ancien pod.
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quotas, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le compte de service
  des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (y compris les règles essentielles interdisant de modifier
`application_database_name`/`application_database_user` ou le
`DOLI_INSTANCE_UNIQUE_ID` généré automatiquement après le premier démarrage).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie simplement le déploiement). Cela supprime tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, le partage Cloud Filestore, les secrets Secret Manager,
les buckets GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le
VPC, le cluster GKE, le Cloud SQL partagé, le registre) sont gérées séparément et ne sont pas
supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (MySQL 8.0), Filestore (NFS), les secrets et le bucket de stockage, puis exécute l'initialisation de la base |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; récupérer le mot de passe administrateur et se connecter ; définir `DOLI_URL_ROOT` |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle (avec les réserves liées à NFS et aux verrous), mettre à jour la version, gérer les secrets et le stockage, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de job d'initialisation, de NFS et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module |
