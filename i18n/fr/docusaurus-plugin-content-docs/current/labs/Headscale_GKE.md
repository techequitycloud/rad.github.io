---
title: "Headscale sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployer Headscale sur GKE Autopilot dans votre propre projet Google Cloud — configuration guidée, vérification, exploitation, observabilité et démantèlement."
---

<!-- translated-from: docs/labs/Headscale_GKE.md @ 3055034 sha256:923eb984be3c -->

# Headscale sur GKE Autopilot — Guide de lab {#headscale-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/Headscale_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 30–45 minutes

Headscale est une implémentation open source et auto-hébergée du serveur de
coordination Tailscale — le plan de contrôle d'un VPN maillé WireGuard privé,
compatible avec les clients Tailscale officiels. Ce lab vous fait parcourir
l'intégralité du cycle de vie opérationnel du module **Headscale on GKE Autopilot**
sur Google Cloud : le déployer, y accéder et le vérifier, enregistrer votre premier
client, l'exploiter au quotidien, l'observer, diagnostiquer les problèmes courants et le
démanteler. Contrairement à la plupart des modules de ce catalogue, il n'y a **aucune base de données
externe** à attendre — Headscale est entièrement autonome autour d'un fichier SQLite
intégré, adossé ici à un véritable PVC de stockage en mode bloc.

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google
Cloud**, et non sur les concepts réseau de Tailscale/WireGuard. Pour la liste complète
des services provisionnés et de chaque paramètre de configuration (organisés par
groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/Headscale_GKE) —
ce lab ne reprend volontairement pas ce détail afin de rester exact
dans le temps.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer les ressources qu'il provisionne.
- Vous connecter au cluster GKE et accéder à la charge de travail en cours d'exécution, y compris via son véritable point de terminaison `/health`.
- Créer le premier utilisateur Headscale et une clé de pré-authentification via `kubectl exec`, puis enregistrer un vrai client Tailscale auprès du serveur.
- Effectuer les opérations du jour 2 — inspecter le StatefulSet et le PVC, comprendre pourquoi la mise à l'échelle horizontale ne s'applique pas, et mettre à jour la version.
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
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous ne nécessite ni l'un ni l'autre.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- *(Facultatif, pour la tâche 2)* le [client Tailscale](https://tailscale.com/download)
  installé sur un appareil que vous pouvez utiliser pour tester un véritable enregistrement.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la barre de navigation supérieure de la plateforme RAD, ouvrez **Headscale
   (GKE)** depuis la liste **Platform Modules** pour commencer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), renseignez
   `project_id` et passez en revue les paramètres. Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/Headscale_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Laissez `stateful_pvc_enabled
   = true` (la valeur par défaut) — c'est ce qui donne à la base de données SQLite de Headscale une véritable
   prise en charge du verrouillage de fichiers. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec
   les journaux en temps réel.

2. La plateforme construit l'image Headscale personnalisée (une base amont construite avec `ko`
   à laquelle s'ajoute une configuration intégrée), provisionne le StatefulSet GKE avec son
   PVC de stockage en mode bloc par pod (monté sur `/var/lib/headscale`), une adresse IP
   statique réservée et un Ingress Gateway API pour un nom d'hôte personnalisé. Il n'y a **ni
   instance Cloud SQL ni job d'initialisation de base de données** à attendre —
   SQLite se crée lui-même au premier démarrage — si bien que les premiers déploiements se terminent généralement
   en **10–20 minutes** environ (le provisionnement du cluster/de la Gateway en représente l'essentiel).

3. Connectez-vous au cluster et repérez l'espace de noms avec des filtres indépendants
   des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep headscale | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Vérifiez que la charge de travail est en cours d'exécution et trouvez son adresse externe :

   ```bash
   kubectl get pods,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Vérifiez que le service est en bonne santé. Headscale expose un véritable point de terminaison
   de santé, sans authentification :

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Consultez les journaux de démarrage pour retrouver la séquence de confirmation qu'un premier démarrage
   réussi produit :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl logs -n "$NS" "$POD" --tail=50
   # Look for lines resembling:
   #   ...generating new private key...
   #   ...database opened successfully...
   #   ...listening and serving HTTP...
   ```

4. **Créez le premier utilisateur et une clé de pré-authentification** en exécutant des commandes directement dans le
   pod en cours d'exécution — l'accès shell de GKE rend cela simple :

   ```bash
   kubectl exec -n "$NS" "$POD" -- /ko-app/headscale users create myuser

   kubectl exec -n "$NS" "$POD" -- /ko-app/headscale preauthkeys create \
     --user myuser --reusable --expiration 1h
   ```

   Copiez la clé de pré-authentification affichée.

5. **Enregistrez un vrai client Tailscale** (facultatif, nécessite que le client
   Tailscale soit installé) :

   ```bash
   tailscale up --login-server="http://${EXTERNAL_IP}" --authkey=<preauthkey-from-step-4>
   # or, if a custom domain is configured:
   # tailscale up --login-server="https://<your-domain>" --authkey=<preauthkey>
   ```

   L'appareil devrait se connecter et apparaître dans le registre des nœuds de Headscale.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail** — le StatefulSet, le pod et le PVC qui héberge SQLite :

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **La mise à l'échelle ne s'applique pas comme pour les autres modules.**
   `max_instance_count` est fixé en dur à `1` dans `Headscale_Common` —
   modifier le paramètre `max_instance_count` dans la plateforme RAD n'a **aucun
   effet** ; Headscale ne prend pas en charge le mode actif-actif et deux processus écrivant dans
   le même fichier SQLite le corrompraient. `min_instance_count = 0` (la
   valeur par défaut) permet la mise à l'échelle jusqu'à zéro.

3. **Mettez à jour la version de l'application** en modifiant le paramètre `application_version`
   dans la plateforme RAD et en l'appliquant via **Update** ; une nouvelle image est construite
   à partir de la base amont épinglée `headscale/headscale:<version>-debug` et une
   mise à jour progressive remplace le pod.

4. **Inspectez la classe de stockage et la taille du PVC** (utile si vous atteignez un jour une
   limite de quota ailleurs dans ce projet — le PVC de Headscale utilise par défaut le HDD
   `pd-standard`, qui puise dans le quota `DISKS_TOTAL_GB`, plus large, et non dans le
   quota `SSD_TOTAL_GB`, plus restreint, que se disputent d'autres modules avec état de ce catalogue) :

   ```bash
   kubectl get pvc -n "$NS" -o wide
   ```

5. **Listez les nœuds enregistrés :**

   ```bash
   kubectl exec -n "$NS" "$POD" -- /ko-app/headscale nodes list
   ```

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux** — depuis `kubectl` ou l'explorateur de journaux (Logs Explorer) :

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez les tableaux de bord GKE / Kubernetes et examinez l'utilisation du CPU
   et de la mémoire des pods ainsi que le nombre de redémarrages (qui doit rester stable — Headscale
   est léger). Le module peut provisionner un **test de disponibilité** (uptime check) sur
   `/health` (lorsqu'il est activé) ; consultez Monitoring → Uptime checks.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il
s'agit de diagnostics au niveau de la plateforme, qui ne changent pas avec les versions de Headscale.

- **Pod non Ready / CrashLoopBackOff :** inspectez les événements et les journaux. Un échec de validation
  de la configuration est la cause la plus fréquente — Headscale 0.26.1 échoue brutalement
  si `noise.private_key_path` est absent ou si le bloc `dns:` est incomplet ; ces deux cas
  sont déjà correctement gérés dans le `config.yaml` livré.
  ```bash
  kubectl describe pod -n "$NS" "$POD"          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" "$POD" --previous       # logs from the crashed container
  ```
- **Erreurs liées au PVC :** contrairement à la variante Cloud Run, ce module utilise par défaut un
  véritable PVC en mode bloc (`stateful_pvc_enabled = true`), vous ne devriez donc
  **pas** voir d'erreurs d'écriture gcsfuse (`BufferedWriteHandler.OutOfOrderError`)
  ici — si c'est le cas, vérifiez si `stateful_pvc_enabled` a été redéfini à
  `false` pour ce déploiement (ce qui revient au montage GCS-Fuse et
  réintroduit le même risque que celui documenté pour `Headscale_CloudRun`).
- **Le client Tailscale ne parvient pas à s'enregistrer / `tailscale up` échoue :** vérifiez
  `enable_iap = false` (IAP exige une identité Google, que la CLI
  `tailscale` ne peut pas présenter) et que l'IP externe/le domaine personnalisé est
  effectivement joignable :
  ```bash
  kubectl get gateway,httproute -n "$NS"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Pod en attente (Pending) / pas d'IP externe :** consultez les événements de `kubectl describe pod` pour
  repérer des problèmes de ressources ou de quota, et vérifiez que l'IP statique réservée et la Gateway
  ont toutes deux été provisionnées avec succès.
- **Erreurs de récupération d'image :** vérifiez que l'image existe dans Artifact Registry et que
  le compte de service des nœuds peut la récupérer.

Consultez la section *Pitfalls* du Guide de configuration pour les pièges propres à chaque
paramètre, notamment la règle essentielle selon laquelle `server_url` ne doit pas changer
une fois que des clients se sont enregistrés, et selon laquelle `stateful_pvc_enabled` doit rester
`true`.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). Delete exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie simplement le déploiement). Cela supprime tout ce que le module a créé —
le StatefulSet Kubernetes, l'espace de noms et le PVC (et avec eux, l'intégralité du registre
des nœuds et la clé privée Noise — chaque client précédemment enregistré devrait
se réenregistrer auprès d'un nouveau déploiement), l'IP statique réservée et
les images Artifact Registry. Les ressources appartenant à **Services_GCP** (le VPC, le cluster
GKE, le registre partagé) sont gérées séparément et ne sont pas supprimées ici.
Rappelez-vous la règle valable pour tout le catalogue : réduire la charge de travail à zéro réplica ne
libère **pas** le PVC — seule la suppression du déploiement (ou du PVC/de l'espace de noms
directement) le fait.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image personnalisée et provisionne le StatefulSet + le PVC en mode bloc, l'IP statique réservée et la Gateway ; ni Cloud SQL, ni job d'initialisation |
| 2 — Accéder et vérifier | Manuel | Se connecter au cluster ; `/health` renvoie 200 ; créer le premier utilisateur + une clé de pré-authentification via `kubectl exec` ; enregistrer un vrai client Tailscale |
| 3 — Exploiter | Manuel | Inspecter le StatefulSet/PVC ; comprendre pourquoi `max_instance_count` n'a aucun effet ; mettre à jour la version ; lister les nœuds |
| 4 — Observer | Manuel | Interroger Cloud Logging ; consulter les métriques Cloud Monitoring et le test de disponibilité |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de pod, de PVC, d'enregistrement des clients et de récupération d'image |
| 6 — Démanteler | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le registre des nœuds |
