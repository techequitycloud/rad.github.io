---
title: "Fider sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez Fider sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Fider_GKE.md @ 3055034 sha256:3e56459b973a -->

# Fider sur GKE Autopilot — Guide de lab {#fider-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Fider est un tableau open source et auto-hébergé de retours et de vote sur les fonctionnalités — les clients
publient des idées, votent et commentent, et vous priorisez votre feuille de route selon la demande. Ce lab
vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Fider on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités du produit Fider. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_GKE) — ce lab
ne reprend volontairement pas ce détail, afin de rester exact dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail et effectuer la configuration initiale
  du site et de l'administrateur de Fider.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et la
  base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL,
  le NFS Filestore, Artifact Registry et les comptes de service partagés dont
  dépend ce module). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme
  détecte automatiquement s'il existe déjà dans le projet cible et, sinon, le
  provisionne avant ce module (voir la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que Owner du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Un accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Fider (GKE)** dans
   la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et
   passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une
   base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager
   (`JWT_SECRET` et le mot de passe de la base de données), un bucket de données Cloud Storage, un montage NFS
   Cloud Filestore pour les pièces jointes (activé par défaut), construit l'image de
   conteneur et exécute un job ponctuel d'initialisation de la base de données qui crée le rôle et la
   base de données `fider`. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud
   SQL domine).

3. Connectez-vous au cluster et découvrez l'espace de noms à l'aide de filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep fider | head -1 | cut -d/ -f2)
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

2. Vérifiez que le service est en bonne santé. Fider expose un point de terminaison `/_health` non authentifié
   qui renvoie `200` une fois que le serveur a démarré et exécuté ses migrations
   de schéma. Le conteneur écoute sur le port **3000** — sur GKE, la variable d'environnement `PORT`
   n'est **pas** injectée automatiquement ; `container_port` et le port de la sonde doivent donc tous deux valoir
   3000, sinon le pod ne devient jamais Ready alors même que l'application est en bonne santé :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/_health"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Il n'y a pas d'identifiants par défaut —
   la première visite vous guide dans la création du **site** et de son compte **propriétaire
   administrateur**. Effectuez cette étape immédiatement après le déploiement.

4. L'e-mail est désactivé pour la démonstration (`EMAIL_NOEMAIL = true`) ; les liens d'inscription et d'invitation
   sont donc écrits dans le journal du pod au lieu d'être envoyés. Consultez les journaux si vous
   invitez d'autres utilisateurs avant de raccorder un véritable serveur SMTP :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     --tail=100 | grep -i "sign-in\|invite"
   ```

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le déploiement, les pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de nombre minimal/maximal d'instances et en cliquant sur **Update** sur
   la page de détails du déploiement — le module est propriétaire de la spécification de la charge de travail, la mise à l'échelle
   est donc une modification de configuration, et non un `kubectl scale` manuel (une modification manuelle serait
   annulée lors du prochain apply). GKE ne prend pas en charge la mise à l'échelle jusqu'à zéro ;
   `min_instance_count` reste donc au moins à `1`.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une
   mise à jour progressive remplace les pods. Comme Fider repose sur NFS, App_GKE
   le déploie avec la stratégie de mise à jour `Recreate` plutôt que `RollingUpdate` —
   deux pods partageant le même volume NFS et la même base de données se retrouveraient en interblocage ; attendez-vous donc à une
   brève interruption pendant une mise à jour, et non à un déploiement sans interruption. Notez que
   `getfider/fider` n'a pas d'étiquette `:latest` — le module associe `latest` à `stable` ;
   fixez une étiquette SHA explicite pour des mises à niveau reproductibles.

4. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~fider"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   `JWT_SECRET` signe tous les jetons d'authentification et de session (y compris les liens
   de connexion magiques envoyés par e-mail) — **ne le renouvelez jamais après le premier démarrage** ; cela
   invaliderait chaque session active et chaque lien de connexion en attente.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. fiderdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^fider" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez le montage NFS :**

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   kubectl get pvc,pv -n "$NS"
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Lorsque l'e-mail est désactivé, les liens d'inscription et d'invitation apparaissent ici — c'est le comportement attendu,
   et non une erreur.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du processeur et
   de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut
   provisionner un **test de disponibilité** (lorsqu'il est activé) ; examinez Monitoring → Uptime
   checks et Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de
diagnostics au niveau de la plateforme, qui ne changent pas d'une version de Fider à l'autre.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de
  vivacité cible `/_health` sur le port 3000 ; un `container_port` incohérent (GKE
  n'injecte pas automatiquement `PORT`) ou une connexion lente à la base de données empêchera le pod de
  devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** vérifiez que l'instance Cloud SQL est `RUNNABLE`,
  que le secret du mot de passe de la base de données a bien été matérialisé dans l'espace de noms et que le job `db-init`
  s'est terminé (il crée de manière idempotente le rôle et la base de données `fider`, et peut être
  réexécuté sans risque).
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Le déploiement progressif semble bloqué après une mise à jour :** c'est le comportement attendu pendant un instant —
  les applications reposant sur NFS utilisent la stratégie `Recreate` ; l'ancien pod est donc entièrement arrêté
  avant que le nouveau ne démarre (contrairement au pod supplémentaire d'un `RollingUpdate`). Vérifiez la progression
  avec :
  ```bash
  kubectl rollout status deploy/<deployment-name> -n "$NS"
  ```
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer
  des problèmes de ressources ou de quota, et vérifiez que le Service LoadBalancer dispose d'une IP
  attribuée.
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **Échecs de montage liés au NFS :** vérifiez que la VM NFS Filestore partagée (gérée par
  `Services_GCP`) était à l'état `RUNNING` avant le déploiement de cette application ; un serveur NFS arrêté ou absent
  au moment du déploiement est une cause fréquente d'erreurs de montage du stockage.
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  ```
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que le
  compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls & Sensible Defaults* du Guide de configuration
pour les pièges propres à chaque paramètre (notamment la règle essentielle de ne jamais renouveler
`JWT_SECRET` après le premier démarrage, pourquoi `application_database_name`/
`application_database_user` sont immuables après le premier déploiement, et pourquoi
`quota_memory_requests`/`quota_memory_limits` exigent des suffixes d'unités binaires).

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — la charge de travail Kubernetes
et son espace de noms, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les
images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le Cloud SQL partagé, le NFS Filestore, le registre) sont gérées séparément et ne sont
pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage, le montage NFS, et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; créer le site et le propriétaire administrateur lors de la première visite |
| 3 — Exploiter | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version (stratégie Recreate), gérer les secrets, accéder à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de déploiement progressif, de planification, de NFS et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module |
