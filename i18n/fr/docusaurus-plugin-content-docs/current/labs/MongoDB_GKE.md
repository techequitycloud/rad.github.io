---
title: "MongoDB sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez MongoDB sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/MongoDB_GKE.md @ 3055034 sha256:74c99a0c80d7 -->

# MongoDB sur GKE Autopilot — Guide de lab {#mongodb-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/MongoDB_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45 à 90 minutes

MongoDB est une base de données documentaire NoSQL très répandue, utilisée pour le stockage flexible de documents
dans la gestion de contenu, les pipelines de données IoT, les backends mobiles et les feature stores
d'IA/ML. Ce lab vous fait parcourir tout le cycle de vie opérationnel du module
**MongoDB on GKE Autopilot** sur Google Cloud : le déployer, y accéder et le vérifier,
l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le démanteler.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**, et non
sur les fonctionnalités de MongoDB. Pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/MongoDB_GKE) — ce
lab ne duplique volontairement pas ce détail afin de rester exact dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution.
- Effectuer les opérations du jour 2 — inspecter, mettre à l'échelle, mettre à jour, et gérer les secrets et le stockage.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et d'exécution les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir la
  tâche 1).
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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **MongoDB (GKE)** dans la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez `project_id` et passez en revue les paramètres.
   Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/MongoDB_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme déploie MongoDB sous la forme d'un StatefulSet sur le cluster GKE Autopilot,
   provisionne un PVC Persistent Disk adossé à un SSD (monté sur `/data/db`),
   génère automatiquement le mot de passe root et le stocke dans Secret Manager, et réplique
   l'image officielle `mongo` dans Artifact Registry. Il n'y a pas d'instance Cloud SQL
   — MongoDB est son propre moteur de base de données. Les premiers déploiements prennent environ
   **10 à 25 minutes** (le provisionnement des nœuds Autopilot et le rattachement du PVC représentent l'essentiel du temps).

3. Connectez-vous au cluster et identifiez l'espace de noms avec des filtres indépendants des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep mongodb | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que le StatefulSet est en cours d'exécution et repérez le point de terminaison du service :

   ```bash
   kubectl get statefulset,pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   > **Remarque :** MongoDB utilise son propre protocole binaire sur le port 27017 — les contrôles
   > d'état HTTP échouent toujours. Le module configure des sondes TCP sur le port 27017. Pour vérifier
   > la connectivité, utilisez `mongosh` ou un test de connexion TCP ci-dessous.

2. Récupérez dans Secret Manager le mot de passe root généré automatiquement :

   ```bash
   MONGO_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~mongo-root-password" --format="value(name)" --limit=1)
   MONGO_PASSWORD=$(gcloud secrets versions access latest \
     --secret="$MONGO_SECRET" --project="$PROJECT")
   echo "Root password retrieved (${#MONGO_PASSWORD} chars)"
   ```

3. Ouvrez une connexion à MongoDB avec `kubectl port-forward` et `mongosh` :

   ```bash
   kubectl port-forward -n "$NS" svc/$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}') 27017:27017 &
   mongosh "mongodb://admin:${MONGO_PASSWORD}@localhost:27017/admin"
   ```

   Une connexion réussie affiche la version de MongoDB et une invite `test>`.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, les pods et (s'ils sont activés) l'autoscaler
   horizontal et la revendication de volume persistant (PVC) :

   ```bash
   kubectl get statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Mettez à l'échelle** en modifiant les paramètres de ressources dans la plateforme RAD et en les appliquant via **Update** — le module
   possède la spécification de la charge de travail, donc la mise à l'échelle est une modification de configuration, et non un
   `kubectl scale` manuel (une modification manuelle serait annulée lors de la prochaine application). Notez que
   `max_instance_count` est imposé à 1 ; les replica sets MongoDB ne sont pas pris en charge par
   ce module.

3. **Mettez à jour la version de l'application** en modifiant le paramètre de version dans la plateforme RAD
   et en l'appliquant via **Update** ; une nouvelle image est répliquée et une mise à jour progressive remplace le pod.
   Testez d'abord les mises à niveau de version majeure sur une réplique — les versions majeures de MongoDB
   modifient le format de stockage sur disque et ne permettent pas de revenir à une version antérieure.

4. **Gérez les secrets et les jobs de sauvegarde :**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~mongo-root-password"
   kubectl get cronjobs -n "$NS"    # scheduled mongodump backup job (if configured)
   ```

5. **Ouvrez une session de base de données** pour inspection ou maintenance (via le port-forward
   établi à la tâche 2) :

   ```bash
   mongosh "mongodb://admin:${MONGO_PASSWORD}@localhost:27017/admin"
   ```

   Le format correct de chaîne de connexion pour se connecter à des bases autres que admin avec
   le compte root est :
   `mongodb://<username>:<password>@<host>:27017/<db>?authSource=admin`

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Filtre de l'explorateur de journaux :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation CPU et
   mémoire des pods, le nombre de redémarrages et l'utilisation du disque du PVC. Le module peut provisionner
   des **règles d'alerte Cloud Monitoring** lorsque `support_users` est configuré ; consultez
   Monitoring → Alerting → Policies.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit
de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de MongoDB.

- **Pod non Ready / CrashLoopBackOff :** examinez les événements et les journaux ; prêtez attention aux
  événements de rattachement du PVC et de récupération d'image :
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Expiration de la sonde de démarrage :** GKE Autopilot doit provisionner un nœud, rattacher le PVC
  et récupérer l'image avant que `mongod` ne démarre. La sonde de démarrage accorde jusqu'à environ 8
  minutes. Vérifiez que le PVC est `Bound` et que le nœud est `Ready`.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl get nodes
  ```
- **Erreurs d'authentification / de connexion :** vérifiez que le secret du mot de passe root a été
  créé, que `MONGO_INITDB_ROOT_PASSWORD` est injecté dans le pod et que
  `mongosh` utilise `?authSource=admin` pour se connecter à des bases autres que admin.
- **Répertoire de données inaccessible :** le conteneur MongoDB s'exécute avec l'UID/GID 999 et
  exige que le montage du PVC sur `/data/db` appartienne à ce GID. Vérifiez que
  `fsGroup: 999` est défini dans le StatefulSet et que le PVC est correctement monté.
  ```bash
  kubectl exec -n "$NS" <pod> -- ls -la /data/db
  ```
- **PVC plein :** un disque plein fait planter `mongod` avec `No space left on device`.
  Vérifiez l'utilisation du disque ; augmentez `stateful_pvc_size` et appliquez la modification via **Update** (la taille du PVC peut seulement être
  augmentée, pas réduite).
- **Pod en attente / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour repérer des problèmes de ressources
  ou de quota, et vérifiez que le Service LoadBalancer s'est vu attribuer une IP.
- **Erreurs de récupération d'image :** vérifiez que l'image `mongo` a bien été répliquée dans Artifact
  Registry et que le compte de service des nœuds peut la récupérer.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD oublie le déploiement). La suppression retire tout ce que le module a créé — le StatefulSet Kubernetes
et l'espace de noms, le PVC et toutes les données MongoDB, les secrets Secret Manager et les images
d'Artifact Registry. Exportez vos données avec `mongodump` avant de supprimer le déploiement si vous devez
les conserver. Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre
partagé) sont gérées séparément et ne sont pas supprimées ici.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module déploie le StatefulSet GKE et le PVC SSD, génère automatiquement le secret du mot de passe root et réplique l'image MongoDB |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; récupérer le mot de passe root ; se connecter avec mongosh via port-forward |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet, mettre à l'échelle (dans les limites d'un seul nœud), mettre à jour la version, gérer les secrets/sauvegardes, accéder à la base |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et les règles d'alerte |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, d'authentification, de sonde de démarrage, d'espace disque et de récupération d'image |
| 6 — Démanteler | Automatisé | La suppression (Trash) retire toutes les ressources du module, y compris les données du PVC |
