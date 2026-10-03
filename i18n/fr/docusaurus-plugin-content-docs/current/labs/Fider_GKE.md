---
title: "Fider sur GKE Autopilot — Guide de Lab"
description: "Lab pratique : déployez Fider sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, opérations, observabilité et suppression."
---

<!-- translated-from: docs/labs/Fider_GKE.md @ 15fd4c7 sha256:00af9eea110c -->

# Fider sur GKE Autopilot — Guide de Lab {#fider-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Fider est un tableau de bord open source auto-hébergé pour les retours et le vote de fonctionnalités — les clients publient des idées, votent et commentent, et vous priorisez votre feuille de route en fonction de la demande. Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Fider sur GKE Autopilot** sur Google Cloud : déployez-le, accédez-y et vérifiez-le, exécutez-le au quotidien, observez-le, diagnostiquez les problèmes courants et supprimez-le.

Le lab se concentre sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non sur les fonctionnalités du produit Fider. Pour la liste complète des services provisionnés et de chaque entrée de configuration (organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_GKE) — ce lab ne duplique délibérément pas ces détails afin qu'ils restent précis au fil du temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il provisionne.
- Vous connecter au cluster GKE, accéder à la charge de travail et effectuer la configuration initiale du site/administrateur de Fider.
- Effectuer les opérations de jour 2 — inspecter, mettre à l'échelle, mettre à jour et gérer les secrets et la base de données.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Cloud SQL, Filestore NFS, Artifact Registry et les comptes de service partagés dont ce module dépend). Vous n'avez pas besoin de le déployer vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà dans le projet cible et le provisionne avant ce module si ce n'est pas le cas (voir Tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et `gcloud auth application-default login` complétés.
- IAM **Propriétaire du projet** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes qu'il affiche en tant que Propriétaire du projet, puis **Vérifier**) et de donner le rôle **Propriétaire** au compte de service de déploiement RAD. Un projet créé par RAD pour vous n'a besoin de rien de tout cela.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page d'entrées (et, dans un projet créé par RAD pour vous, guère plus que le nom du locataire et la région). Toutes les autres entrées du Guide de configuration — y compris les entrées de mise à l'échelle et de version dans les tâches de jour 2 — sont modifiées ultérieurement avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Fider (GKE)** depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur l'**Assistant Conversationnel** si vous détenez des crédits achetés ou si vous êtes un partenaire ou un administrateur), définissez `project_id`, et examinez les entrées. Ne configurez que ce dont vous avez besoin — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/Fider_GKE) documente chaque entrée par groupe, avec les valeurs par défaut. Cliquez sur **Deploy Module**, examinez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie la charge de travail dans le cluster GKE Autopilot, provisionne une base de données Cloud SQL (PostgreSQL 15) avec ses secrets Secret Manager (`JWT_SECRET` et le mot de passe de la base de données), un bucket de données Cloud Storage (NFS est désactivé par défaut — Fider stocke les pièces jointes dans PostgreSQL), construit l'image conteneur et exécute un job d'initialisation de base de données unique qui crée le rôle `fider` et la base de données. Les premiers déploiements prennent environ **20 à 35 minutes** (la création de Cloud SQL domine).

3. Connectez-vous au cluster et découvrez l'espace de noms avec des filtres agnostiques au nom :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep fider | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirmez que le service est sain. Fider expose un point de terminaison `/_health` non authentifié qui renvoie `200` une fois que le serveur a démarré et exécuté ses migrations de schéma. Le conteneur écoute sur le port **3000** — sur GKE, l'environnement `PORT` n'est **pas** injecté automatiquement, donc `container_port` et le port de la sonde doivent tous deux être 3000 ou le pod ne devient jamais Ready même si l'application est saine :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/_health"   # expect 200
   ```

3. Ouvrez `http://${EXTERNAL_IP}` dans un navigateur. Il n'y a pas de identifiants par défaut — la première visite vous guide à travers la création du **site** et de son compte **administrateur propriétaire**. Complétez cela immédiatement après le déploiement.

4. L'e-mail est désactivé pour la démo (`EMAIL_NOEMAIL = true`), donc les liens d'inscription et d'invitation sont imprimés dans le journal du pod plutôt que d'être envoyés. Vérifiez les journaux si vous invitez des utilisateurs supplémentaires avant de configurer un vrai SMTP :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     --tail=100 | grep -i "sign-in\|invite"
   ```

---

## Tâche 3 — Opérer et maintenir en fonctionnement (Jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — déploiement, pods et l'autoscaler horizontal :

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les entrées min/max d'instances et en cliquant sur **Update** sur la page des détails du déploiement — le module possède la spécification de la charge de travail, donc la mise à l'échelle est un changement de configuration, pas un `kubectl scale` manuel (une modification manuelle serait annulée lors du prochain apply). GKE ne prend pas en charge la mise à l'échelle à zéro, donc `min_instance_count` reste au moins `1`.

3. **Mettez à jour la version de l'application** en modifiant l'entrée `application_version` dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite et une mise à jour progressive remplace les pods. Comme Fider est basé sur NFS, App_GKE le déploie avec la stratégie de mise à jour `Recreate` plutôt que `RollingUpdate` — deux pods partageant le même volume NFS et la même base de données se bloqueraient, attendez-vous donc à un bref moment d'indisponibilité pendant une mise à jour, et non à un déploiement sans interruption. Notez que `getfider/fider` n'a pas de tag `:latest` — le module épingle `latest` à `stable` ; épinglez un tag SHA explicite pour des mises à niveau reproductibles.

4. **Gérez les secrets et les jobs :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~fider"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   `JWT_SECRET` signe tous les jetons d'authentification et de session (y compris les liens de connexion magiques envoyés par e-mail) — **ne le faites jamais pivoter après le premier démarrage** ; cela invaliderait chaque session active et chaque lien de connexion en attente.

5. **Ouvrez une session de base de données** pour l'inspection ou la maintenance :

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. fiderdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^fider" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Vérifiez le montage NFS :**

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   kubectl get pvc,pv -n "$NS"
   ```

---

## Tâche 4 — Observer : Journalisation et Surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'Explorateur de journaux :

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'Explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Lorsque l'e-mail est désactivé, les liens d'inscription/invitation apparaissent ici — c'est normal, pas une erreur.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU et de la mémoire des pods, le nombre de redémarrages et les métriques de requêtes. Le module peut provisionner un **test de disponibilité** (lorsqu'il est activé) ; examinez Surveillance → Tests de disponibilité et Alertes → Règles.

---

## Tâche 5 — Dépannage et débogage [Manuel] {#task-5--troubleshoot--debug-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer. Ce sont des diagnostics au niveau de la plateforme et ils ne changent pas avec les versions de Fider.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. La sonde de vivacité cible `/_health` sur le port 3000 ; un `container_port` non concordant (GKE n'injecte pas automatiquement `PORT`) ou une connexion lente à la base de données empêchera le pod de devenir Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Erreurs de connexion à la base de données :** confirmez que l'instance Cloud SQL est `RUNNABLE`, que le secret du mot de passe de la base de données est matérialisé dans l'espace de noms et que le job `db-init` est terminé (il crée de manière idempotente le rôle/la base de données `fider` et peut être réexécuté en toute sécurité).
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Le déploiement semble bloqué après une mise à jour :** c'est normal pendant un instant — les applications basées sur NFS utilisent la stratégie `Recreate`, donc l'ancien pod est entièrement terminé avant le démarrage du nouveau (contrairement à un `RollingUpdate`). Confirmez la progression avec :
  ```bash
  kubectl rollout status deploy/<deployment-name> -n "$NS"
  ```
- **Pod en attente / pas d'IP externe :** vérifiez les événements `kubectl describe pod` pour les problèmes de ressources ou de quota, et confirmez que le service LoadBalancer a une IP attribuée.
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **Erreurs de montage liées à NFS :** confirmez que la VM Filestore NFS partagée (gérée par `Services_GCP`) était `RUNNING` avant le déploiement de cette application ; un serveur NFS arrêté/absent au moment du déploiement est une cause fréquente d'erreurs de montage de stockage.
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  ```
- **Erreurs d'extraction d'image :** confirmez que l'image existe dans Artifact Registry et que le compte de service du nœud peut l'extraire.

Consultez la section *Pièges de configuration et valeurs par défaut judicieuses* du Guide de configuration pour les pièges spécifiques aux paramètres (y compris la règle critique de ne jamais faire pivoter `JWT_SECRET` après le premier démarrage, pourquoi `application_database_name`/`application_database_user` sont immuables après le premier déploiement, et pourquoi `quota_memory_requests`/`quota_memory_limits` nécessitent des suffixes d'unité binaire).

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez **Purge** à la place (depuis la même boîte de dialogue **Delete**) — cela supprime le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (cela fait oublier le déploiement à RAD). Cela supprime tout ce que le module a créé — la charge de travail et l'espace de noms Kubernetes, la base de données Cloud SQL, les secrets Secret Manager, les buckets GCS et les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, Cloud SQL partagé, Filestore NFS, le registre) sont gérées séparément et ne sont pas supprimées ici.

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie la charge de travail GKE, Cloud SQL (PostgreSQL 15), les secrets, le bucket de stockage, le montage NFS et exécute l'initialisation de la base de données |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; le contrôle de santé réussit ; créer le site et l'administrateur propriétaire lors de la première visite |
| 3 — Opérer | Manuel | Inspecter la charge de travail, mettre à l'échelle, mettre à jour la version (stratégie de recréation), gérer les secrets, accès à la base de données |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de base de données, de déploiement, de planification, de NFS et d'extraction d'image |
| 6 — Supprimer | Automatisé | La suppression (Corbeille) supprime toutes les ressources du module |
