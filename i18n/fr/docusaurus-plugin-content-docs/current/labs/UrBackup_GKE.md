---
title: "UrBackup sur GKE Autopilot — Guide de lab"
description: "Lab pratique : déployez UrBackup sur GKE Autopilot dans votre propre projet Google Cloud — mise en place guidée, vérification, exploitation, observabilité et suppression."
---

<!-- translated-from: docs/labs/UrBackup_GKE.md @ 3055034 sha256:78a672db2522 -->

# UrBackup sur GKE Autopilot — Guide de lab {#urbackup-on-gke-autopilot--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/UrBackup_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 60 à 90 minutes

UrBackup est un système open source de sauvegarde réseau client/serveur pour Windows,
Linux et macOS : sauvegardes au niveau des fichiers et sauvegardes d'images disque complètes, déduplication
côté client par liens physiques (hardlinks) et interface web d'administration. Ce module déploie le
**serveur** UrBackup sur GKE Autopilot, avec ses données persistantes (base de données du serveur
+ toutes les données de sauvegarde des clients) sur un unique Persistent Volume bloc GKE, ainsi qu'un
Service Kubernetes multiport dédié afin que de véritables agents clients de sauvegarde — exécutés
sur les propres PC des utilisateurs, entièrement en dehors de ce projet GCP — puissent se connecter sur les ports
TCP/UDP bruts dont le protocole de sauvegarde a besoin. Ce lab vous fait parcourir le cycle de vie
opérationnel complet du module **UrBackup on GKE Autopilot** : le déployer,
vérifier qu'il est joignable, connecter un véritable client, l'exploiter au quotidien, l'observer,
diagnostiquer les problèmes courants et le supprimer.

**Il n'existe pas de variante Cloud Run de ce module et il n'y en aura jamais.**
Le protocole client d'UrBackup nécessite que trois ports TCP bruts (`55413`, `55414`,
`55415`) ainsi que la diffusion UDP de découverte sur le réseau local (`35622`-`35623`) soient
joignables simultanément. L'entrée de Cloud Run est limitée au HTTP(S) sur un seul port et ne peut exposer
ni du TCP brut multiport ni aucun trafic UDP. Il s'agit d'une décision d'architecture permanente,
de la même catégorie que les autres modules de ce catalogue disponibles uniquement en Common+GKE
(Kopia, RocketChat, Immich, Temporal, Prowlarr, VictoriaMetrics, Plausible,
LobeChat, Supabase, Woodpecker).

Le lab porte sur l'exploitation du **module GKE et de la plateforme Google Cloud**,
et non sur les fonctionnalités de configuration des sauvegardes propres à UrBackup, au-delà de ce qui est nécessaire pour
prouver que le déploiement fonctionne de bout en bout. Pour la liste complète des services
provisionnés et de chaque paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/UrBackup_GKE)
— ce lab ne reprend volontairement pas ce détail afin de rester exact
dans la durée.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et localiser les ressources qu'il
  provisionne, y compris le volume bloc persistant et le Service
  multiport dédié.
- Comprendre pourquoi les données persistantes d'UrBackup résident sur un unique PVC bloc
  (et non sur GCS) et pourquoi cela compte pour la planification de capacité.
- Accéder à l'interface web, terminer l'assistant de configuration administrateur initial et confirmer
  que le serveur est réellement prêt à accepter des connexions de clients.
- Effectuer les opérations du jour 2 — inspecter la charge de travail, le PVC et le
  Service multiport ; mettre à jour la version ; comprendre la limite de mise à l'échelle
  à une seule instance.
- Observer la charge de travail avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de déploiement et de connectivité les plus courants.
- Supprimer proprement le déploiement.

## Prérequis {#prerequisites}

- **Services_GCP** (fournit le VPC, le cluster GKE Autopilot, Artifact Registry
  et les comptes de service partagés dont dépend ce module). Vous n'avez pas besoin de le déployer
  vous-même au préalable — la plateforme détecte automatiquement s'il existe déjà
  dans le projet cible et, sinon, le provisionne avant ce module (voir
  la tâche 1).
- Un projet Google Cloud avec la **facturation activée**.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` effectués.
- Le rôle IAM **Project Owner** (ou équivalent) sur le projet.
- **Vous apportez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD. Un projet que RAD crée pour vous n'exige ni l'un ni l'autre.
- **Le mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres (et, dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Tout autre paramètre du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifie ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Sur un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- Un **accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.
- (Facultatif, pour un aller-retour client complet) **Une machine physique ou virtuelle sur laquelle vous pouvez
  installer le client UrBackup** — Windows, Linux ou macOS.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **UrBackup
   (GKE)** dans la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), définissez
   `project_id` et passez en revue les paramètres. **Avant de déployer, définissez
   `stateful_pvc_size`** sur une valeur réaliste pour ce lab (la valeur par défaut de 200Gi
   convient pour un pilote ou un lab, mais vérifiez-la — ce module contient
   de véritables données de sauvegarde, et pas seulement la configuration de l'application). Configurez tout autre élément nécessaire
   — le [Guide de configuration](https://docs.radmodules.dev/docs/modules/UrBackup_GKE)
   documente chaque paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état
   du déploiement avec les journaux en temps réel.

2. La plateforme construit une image de conteneur en enveloppe légère (l'image officielle du serveur
   UrBackup avec un correctif du point d'entrée, appliqué au build, qui redirige les données
   de sauvegarde vers le PVC monté), provisionne un Persistent Volume Claim bloc
   GKE et provisionne un Service `LoadBalancer` multiport dédié
   pour les véritables clients de sauvegarde (en plus du Service Foundation standard
   à port unique, qui reste uniquement interne). Le premier déploiement
   prend généralement **8 à 12 minutes**.

3. Connectez-vous au cluster et repérez l'espace de noms avec un filtre indépendant
   des noms :

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep urbackup | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   kubectl get pvc -n "$NS"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le pod s'exécute :

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pods -n "$NS"                 # expect 1/1 Running
   ```

2. Confirmez que le volume persistant est lié et vérifiez la redirection des données de sauvegarde :

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" "$POD" -- cat /var/urbackup/backupfolder
   # Should read /var/urbackup/backups
   kubectl exec -n "$NS" "$POD" -- ls -la /var/urbackup
   ```

3. Trouvez l'IP externe du Service multiport dédié (c'est elle que contactent les véritables
   clients, et NON l'IP du Service géré par la Foundation) :

   ```bash
   kubectl get svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.metadata.name contains "client-ports")].status.loadBalancer.ingress[0].ip}')
   # If the jsonpath filter above doesn't match your kubectl version, just read it from the list:
   kubectl get svc -n "$NS" -o wide | grep client-ports
   ```

   Si la colonne `EXTERNAL-IP` affiche `<pending>`, patientez quelques minutes et
   vérifiez de nouveau — le provisionnement d'un LoadBalancer GCP est asynchrone et ce module
   ne bloque pas l'application en l'attendant.

4. **Ouvrez l'interface web** à l'adresse `http://<EXTERNAL_IP>:55414` et terminez
   l'assistant de configuration initial pour créer le compte administrateur — il n'existe aucun
   identifiant prédéfini pour cette image ; c'est attendu, ce n'est pas un bogue.
   Confirmez que vous arrivez sur le tableau de bord authentifié.

5. **(Facultatif) Connectez un véritable client.** Installez le client UrBackup sur une
   machine de test, faites-le pointer vers `<EXTERNAL_IP>` (ou ajoutez-le manuellement depuis
   l'interface web du serveur sous **Settings → Add new client**) et déclenchez une
   sauvegarde manuelle. Confirmez que la sauvegarde apparaît dans la vue **Status** /
   **Backups** du serveur — cela prouve que le volume persistant, l'accessibilité des ports
   et le protocole client-serveur fonctionnent tous de bout en bout, et pas seulement que le
   serveur a démarré.

---

## Tâche 3 — Exploiter et maintenir en service (jour 2) [Manuel] {#task-3--operate--keep-it-running-day-2-manual}

1. **Inspectez la charge de travail et son PVC :**

   ```bash
   kubectl get statefulset,pods,svc,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl logs -n "$NS" "$POD" --tail=100
   ```

2. **Surveillez l'utilisation du PVC à mesure que votre parc de clients grandit** — c'est la métrique
   du jour 2 la plus importante pour ce module :

   ```bash
   kubectl exec -n "$NS" "$POD" -- df -h /var/urbackup
   ```

   Si l'utilisation approche de la capacité, augmentez `stateful_pvc_size` via le flux
   **Update** de la plateforme RAD (l'extension d'un PVC se fait généralement en ligne avec les
   StorageClasses par défaut de GKE — confirmez que le redimensionnement est terminé avec `kubectl get
   pvc -n "$NS"`).

3. **Mettez à jour la version de l'application** en modifiant `application_version` dans
   la plateforme RAD et en l'appliquant via **Update**. Une nouvelle image est construite et
   le pod est recréé ; le volume persistant (et tout ce qu'il contient) n'est
   pas modifié.

4. **Ne dépassez pas une instance.** `max_instance_count` est de fait
   plafonné à `1` — la base de données SQLite intégrée et la déduplication par
   liens physiques n'ont aucune coordination multi-instances.

5. **Ne descendez pas à zéro instance pendant de longues périodes.** `min_instance_count` vaut
   `1` par défaut, délibérément — les véritables clients se connectent selon leur propre planning
   automatique, à des moments arbitraires, et un serveur réduit à zéro manquerait
   silencieusement ces connexions.

---

## Tâche 4 — Observer : journalisation et surveillance [Manuel] {#task-4--observe-logging--monitoring-manual}

1. **Journaux :**

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=100 -f
   ```

   Filtre du Logs Explorer :
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Surveillance** — ouvrez le tableau de bord GKE Workloads et examinez le CPU et la
   mémoire du pod, ainsi que l'utilisation du disque du PVC au fil du temps, à mesure que les sauvegardes des clients
   s'accumulent. `uptime_check_config` est **désactivé par défaut**.

3. **Activité de sauvegarde des clients** — le signal le plus utile pour savoir si tout « fonctionne
   vraiment » est la page **Status** de l'interface web du serveur lui-même, qui liste chaque
   client enregistré et l'horodatage de sa dernière sauvegarde.

---

## Tâche 5 — Dépanner et déboguer [Manuel] {#task-5--troubleshoot--debug-manual}

- **Pod bloqué en `Pending` :** vérifiez d'abord les problèmes de provisionnement du PVC — ce
  module demande un PVC HDD (`standard`) potentiellement volumineux :
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>
  ```
  Un PVC en `Pending` accompagné d'un événement de dépassement de quota signifie que le quota
  `DISKS_TOTAL_GB` du projet (ou, si vous avez remplacé `stateful_pvc_storage_class` par une
  classe SSD, `SSD_TOTAL_GB`) est épuisé — réduisez `stateful_pvc_size`
  ou demandez une augmentation de quota.

- **Pod en cours d'exécution mais interface web inaccessible :** vérifiez si vous
  attendez l'IP externe du Service multiport dédié, et non celle du
  Service géré par la Foundation (qui est en `ClusterIP` par défaut et n'a jamais été
  destiné à être joignable depuis l'extérieur pour ce module) :
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```

- **Erreurs d'autorisation de fichiers dans les journaux (`/var/urbackup` non accessible en écriture) :** vérifiez
  le propriétaire et la concordance PUID/PGID :
  ```bash
  kubectl exec -n "$NS" "$POD" -- ls -la /var/urbackup
  kubectl exec -n "$NS" "$POD" -- id
  ```
  Si vous réutilisez le stockage d'une installation UrBackup antérieure non conteneurisée,
  `urbackup_puid`/`urbackup_pgid` devront peut-être correspondre à l'UID/GID qui
  possédait initialement ces données.

- **Le client ne parvient pas à découvrir le serveur ou à s'y connecter :** confirmez que les CINQ ports
  sont réellement joignables, et pas seulement le port de l'interface web — les ports UDP de découverte
  sur le réseau local, en particulier, sont faciles à négliger lorsque vous testez depuis l'extérieur du
  réseau local (la découverte par diffusion UDP ne fonctionne généralement pas du tout à travers
  Internet ; utilisez le mode de connexion manuel « Internet Server » du client
  et uniquement les ports TCP pour les clients distants) :
  ```bash
  kubectl get svc -n "$NS" -o wide
  # Confirm 55413, 55414, 55415/tcp and 35622-35623/udp are all listed on
  # the *-client-ports Service, not just 55414.
  ```

- **Plusieurs réplicas / tentative de mise à l'échelle :** ne le faites pas — la base de données SQLite
  intégrée et la déduplication par liens physiques ne prennent pas en charge des instances
  de serveur simultanées. Conservez `max_instance_count = 1`.

- **Tentative de déployer UrBackup sur Cloud Run à la place :** ne le faites pas — il n'existe pas de
  module `UrBackup_CloudRun`, et il n'y en aura pas. L'entrée de Cloud Run,
  limitée au HTTP(S) sur un seul port, ne peut exposer le protocole client brut d'UrBackup, TCP
  multiport + UDP, dans aucune configuration. Utilisez `UrBackup_GKE`.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges
propres à chaque paramètre (notamment les recommandations sur la taille et la classe de stockage du PVC, et
les sorties à utiliser pour la connectivité des clients).

---

## Tâche 6 — Supprimer [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash**
(**Delete**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement
du déploiement est conservé pour l'historique). Si un déploiement est bloqué et que la
plateforme RAD ne peut plus le gérer (par exemple après des modifications manuelles
en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cette action retire le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud (RAD
oublie le déploiement). Cela supprime tout ce que le module a créé —
la charge de travail Kubernetes, l'espace de noms, le Service multiport dédié et le
volume persistant (**toutes les données de sauvegarde qu'il contient sont supprimées avec lui** — voir ci-dessous).
Les ressources appartenant à **Services_GCP** (le VPC, le cluster GKE, le registre) sont
gérées séparément et ne sont pas supprimées ici.

> **Avant de supprimer**, sachez que TOUT l'historique de sauvegarde des clients enregistrés
> réside entièrement sur le PVC bloc que ce module provisionne — supprimer
> le déploiement supprime ce PVC avec tout le reste, sans aucune
> étape d'export ou de migration distincte intégrée à ce module. Si vous devez
> conserver les données de sauvegarde, prenez un instantané du disque persistant sous-jacent
> (`gcloud compute disks snapshot`) avant la suppression.

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module construit l'image en enveloppe légère, provisionne le PVC bloc et déploie la charge de travail ainsi que le Service multiport dédié |
| 2 — Accéder et vérifier | Manuel | Confirmer le PVC et les liens symboliques, trouver l'IP externe destinée aux clients, terminer la configuration administrateur initiale, connecter éventuellement un véritable client |
| 3 — Exploiter | Manuel | Inspecter la charge de travail/le PVC, surveiller l'utilisation du disque à mesure que le parc grandit, mettre à jour la version, comprendre la limite d'une seule instance |
| 4 — Observer | Manuel | Interroger Cloud Logging ; examiner les métriques Cloud Monitoring et l'utilisation du disque du PVC ; vérifier l'état des sauvegardes des clients dans l'interface web |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes de quota du PVC, de Service/connectivité, d'autorisations et de mise à l'échelle |
| 6 — Supprimer | Automatisé | Delete (Trash) supprime toutes les ressources du module, y compris le volume persistant et TOUTES les données de sauvegarde qu'il contient |
