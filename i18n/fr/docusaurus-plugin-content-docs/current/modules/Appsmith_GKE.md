---
title: "Appsmith sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Appsmith sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Appsmith_GKE.md @ e69407af sha256:2293f4f8fe69 -->

# Appsmith sur GKE Autopilot {#appsmith-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Appsmith_GKE.png" alt="Appsmith sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Appsmith est une plateforme open source low-code pour la création d'outils
internes, de panneaux d'administration et de tableaux de bord — une
alternative auto-hébergée à Retool. L'édition Communauté est livrée sous la
forme d'un conteneur "fat" unique qui regroupe un MongoDB embarqué, Redis, le
backend Java et le client React derrière nginx, persistant tout l'état de
l'application sous `/appsmith-stacks`. Ce module déploie Appsmith sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Appsmith utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Appsmith sur RAD, et comment cela se compare {#what-appsmith-costs-on-rad-and-how-that-compares}

**Appsmith sur le module GKE Autopilot de RAD coûte environ 78 US$ par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des frais de module uniques de 75 crédits (7,50 US$ au prix de la recharge) dans un projet que vous possédez, et 67,5 crédits (10 % de moins) dans un projet géré par RAD. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 78 US$ par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 78 US$ par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **79 crédits par jour**, soit environ 2 370 par mois (environ 237 US$ au prix de la recharge, 190 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ en recharge unique, et moins avec un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | 0 US$ si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 US$ (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 78 US$** |

### Comment cela se compare {#how-it-compares}

- Retool, l'outil low-code qu'Appsmith vise à remplacer, facture par siège : son plan Team est de **10 £/développeur/mois** plus **6 £/utilisateur interne/mois** (facturation mensuelle), et son plan Business de **52 £/développeur/mois** plus **14 £/utilisateur interne/mois** — une facture qui augmente avec chaque personne qui touche l'outil, alors que le coût d'Appsmith ici n'augmente pas.
- **RAD exécute le projet open source lui-même, et non une location hébergée par un fournisseur.** Vous obtenez le même logiciel, sur votre propre infrastructure (ou celle de RAD), au lieu d'un abonnement par siège ou par utilisation qui augmente indépendamment de ce que vous utilisez réellement.
- **Par rapport à un serveur auto-géré nu :** Exécuter le même logiciel open source vous-même, un Hetzner CPX22 (2 vCPU/4 Go, environ 24 $/mois) ou un DigitalOcean 2 vCPU/4 Go Droplet (également 24 $/mois) est à peu près la même chose ; un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois. RAD n'est pas moins cher que cela en termes monétaires — la différence est la base de données gérée, Secret Manager et la surveillance qui sont inclus avec le module au lieu d'être votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Appsmith s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet, et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que de faire fonctionner Appsmith en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 US$), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que RAD gère uniquement pour la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'Appsmith écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — la suppression logicielle de Cloud Storage est explicitement désactivée pour ce bucket. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement, et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 80 crédits (environ 8 US$) dans votre propre projet, ou 72,5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet d'économiser de l'argent une fois qu'Appsmith serait autrement inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 3 jours ou plus dans votre propre projet (2,61 US$/jour) ou 1 jour ou plus dans un projet géré par RAD (79 crédits/jour).
- **Le cluster GKE lui-même est une infrastructure partagée.** Si une autre application utilise le même cluster Autopilot, la suppression d'Appsmith seul ne sauve que son propre pod ; les frais de gestion du cluster ne diminuent que si rien d'autre dans le projet n'en a besoin.
- **Conservez d'abord vos données.** Tout ce qu'Appsmith écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'Appsmith dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Appsmith pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration ; [Tarification Retool](https://retool.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Appsmith s'exécute comme une charge de travail de conteneur "fat" unique avec
tout l'état — le MongoDB embarqué, Redis, les actifs téléchargés et la
configuration — sur un seul volume persistant. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod StatefulSet à conteneur unique sur le port 80, 2 vCPU / 2 Gi par défaut |
| État persistant | PersistentVolumeClaim (`stateful_pvc_enabled`) | PVC de 20 Gi monté à `/appsmith-stacks`, supportant le MongoDB embarqué, Redis, les téléchargements et la configuration |
| Image de conteneur | Docker Hub (pré-construite) | `appsmith/appsmith-ce`, mise en miroir dans Artifact Registry par défaut |
| Secrets | Secret Manager | Auto-généré `APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT`, `APPSMITH_SUPERVISOR_PASSWORD` |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé avec certificat géré par Google activé par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** Appsmith CE exécute son propre MongoDB
  embarqué à l'intérieur du conteneur fat ; `database_type` est fixé à
  `NONE` et `enable_cloudsql_volume` par défaut à
  `false`. Il n'y a pas de sidecar Cloud SQL Auth Proxy pour ce
  module — tout persiste sur le PVC propre au pod à la place.
- **La persistance est un PVC par pod, pas NFS.** `stateful_pvc_enabled = true` par
  défaut, ce qui résout automatiquement `workload_type` en
  `StatefulSet` et monte un PVC de 20 Gi à `/appsmith-stacks`.
  `enable_nfs` par défaut à `false` — NFS n'est
  offert que pour les appelants qui préfèrent un volume Filestore partagé au
  lieu du PVC de bloc, mais le MongoDB embarqué fait son propre verrouillage de
  fichiers, donc le PVC est le choix naturel (et NFS est plus sujet aux
  problèmes de verrouillage en écriture pour les bases de données embarquées ;
  voir les conseils généraux NFS/SQLite du dépôt).
- **Réplica unique, contrainte forte.** `min_instance_count = 1`,
  `max_instance_count = 1`. Plusieurs réplicas obtiendraient chacun un PVC
  **vide** (les PVC StatefulSet sont par pod, non partagés) et exécuteraient
  des instances MongoDB embarquées indépendantes et divergentes — il n'y a pas
  de clustering. `max_instance_count` n'est pas bloqué au-dessus de 1 au
  moment de la planification (seul `min ≤ max` est appliqué), donc
  l'augmenter est une véritable erreur.
- **L'image fat est tirée pré-construite de Docker Hub.** `container_image_source`
  par défaut à `"prebuilt"` (`appsmith/appsmith-ce`),
  correctement transmise à la fondation App_GKE — il n'y a pas de Dockerfile
  ou de build personnalisé pour ce module. `enable_image_mirroring = true` copie
  l'image dans Artifact Registry pour éviter les limites de débit de Docker
  Hub.
- **Trois secrets sont auto-générés et requis pour la continuité des données.**
  `APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT` sécurisent le
  chiffrement AES-256 des identifiants de source de données et des clés SSH Git
  au repos — la modification de l'un ou l'autre après le premier démarrage rend
  les données précédemment chiffrées illisibles. `APPSMITH_SUPERVISOR_PASSWORD`
  protège le panneau de contrôle de processus interne
  `/supervisor` du conteneur.
- **`enable_redis` et `database_type` sont des leurres pour cette
  application.** Appsmith CE regroupe son propre Redis et Mongo en interne ;
  il ne lit pas les variables d'environnement génériques
  `REDIS_HOST`/`REDIS_URL` que la fondation App_GKE
  injecterait si `enable_redis` était activé, et
  `database_type` est fixé à `NONE`. Laissez les
  deux à leurs valeurs par défaut.
- **Le routage de domaine personnalisé est activé par défaut.** Contrairement
  à la plupart des modules, `enable_custom_domain = true` est activé par défaut
  (bien que `application_domains` soit vide jusqu'à ce que vous ajoutiez un
  nom d'hôte).
- **L'installation au premier démarrage est autonome.** L'image fat
  initialise son propre MongoDB et Redis embarqués au premier démarrage ; il
  n'y a pas de `db-init` ou de job de migration séparé pour ce
  module (`initialization_jobs` par défaut à `[]`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Appsmith {#a-gke-autopilot--the-appsmith-workload}

Appsmith s'exécute comme un `StatefulSet` (sélectionné
automatiquement car `stateful_pvc_enabled
= true`), donnant au pod unique une
identité stable et son propre PVC lors des replanifications. Le conteneur fat
est lent à démarrer (Mongo embarqué + Redis + backend Java), alors prévoyez
plusieurs minutes avant qu'il ne signale qu'il est prêt.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la
  charge de travail Appsmith pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name~appsmith" 2>/dev/null || \
    kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail StatefulSet vs Déploiement.

### B. Stockage persistant — PersistentVolumeClaim {#b-persistent-storage--persistentvolumeclaim}

Tout l'état d'Appsmith — les fichiers de données MongoDB embarqués, le dump
Redis, les actifs téléchargés, les données de plugin et la configuration
d'application connectée à Git — réside sur un seul PVC de bloc de 20 Gi
monté à `/appsmith-stacks`. Comme il s'agit d'un PVC StatefulSet par
pod (pas un montage NFS partagé), il survit aux redémarrages/replanifications
de pod mais n'est **pas** partagé entre les réplicas.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims /
  PersistentVolumes.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- du -sh /appsmith-stacks
  ```

Voir [App_GKE](App_GKE.md) Groupe 7 pour la sélection de StorageClass (SSD
`standard-rwo` par défaut ; remplacer par HDD `standard` si le
quota SSD régional est limité).

### C. Image de conteneur et Artifact Registry {#c-container-image--artifact-registry}

L'image déployée est l'image fat officielle `appsmith/appsmith-ce` de
Docker Hub — aucun Dockerfile ou étape Cloud Build ne la construit. Avec
`enable_image_mirroring = true` (par défaut), elle est d'abord copiée dans Artifact
Registry afin que le cluster tire de le réseau de Google plutôt que
directement de Docker Hub.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --filter="name~appsmith"
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo-name>" --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets Appsmith sont générés automatiquement et stockés dans Secret
Manager : `APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT` (les deux
sécurisent le chiffrement au repos des identifiants de source de données et
des clés SSH Git), et `APPSMITH_SUPERVISOR_PASSWORD` (protège le panneau de
supervision interne du conteneur). Sur GKE, les secrets sont projetés dans le
pod via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~appsmith"
  gcloud secrets versions access latest --secret=<encryption-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements). `enable_custom_domain = true` par défaut —
ajoutez un nom d'hôte à `application_domains` pour provisionner un
certificat géré par Google.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte optionnels sont disponibles
(`uptime_check_config`, `alert_policies`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Appsmith {#3-appsmith-application-behaviour}

- **Premier démarrage autonome — pas de job d'initialisation.** L'image fat
  initialise son MongoDB et Redis embarqués, et crée les données
  d'application initiales au premier démarrage. `initialization_jobs` par
  défaut à `[]` ; seuls les jobs fournis par l'appelant
  sont honorés.
- **L'état persistant réside entièrement sur le PVC.** `/appsmith-stacks`
  contient le répertoire de données Mongo, le dump Redis, les actifs
  téléchargés/plugins et les données d'application connectées à Git. Perdre
  le PVC, c'est tout perdre — il n'y a pas de base de données séparée sur
  laquelle se rabattre.
- **Les clés de chiffrement ne doivent pas changer après le premier
  démarrage.** `APPSMITH_ENCRYPTION_PASSWORD` et `APPSMITH_ENCRYPTION_SALT` sont
  générées une fois et stockées dans Secret Manager ; les faire pivoter
  indépendamment d'une réinitialisation complète des données rend les
  identifiants de source de données et les clés SSH Git précédemment
  enregistrés indéchiffrables. `APPSMITH_DISABLE_TELEMETRY = "true"` est défini par
  défaut pour désactiver la télémétrie d'utilisation anonyme.
- **Ne définissez pas `APPSMITH_DB_URL` / `APPSMITH_REDIS_URL`.** La
  propre configuration du module Common évite délibérément d'injecter ces
  éléments — le Mongo/Redis interne du conteneur fat par défaut à
  `localhost`, et les pointer vers un datastore externe
  interrompt le démarrage.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /api/v1/health`
  sur le port 80, avec une fenêtre généreuse (~10 minutes :
  `initial_delay_seconds = 120`, `period_seconds = 15`, `failure_threshold = 40`)
  pour s'adapter au démarrage lent du backend MongoDB + Redis + Java groupé.
  La sonde de vivacité est le même chemin avec des seuils plus stricts
  (`initial_delay_seconds = 60`, `period_seconds = 30`, `failure_threshold = 3`)
  une fois l'application démarrée.
- **StatefulSet à réplica unique, stratégie `RollingUpdate`.** Avec
  `max_instance_count = 1`, il n'y a qu'un seul pod, donc le
  `stateful_update_strategy = "RollingUpdate"` par défaut recrée simplement ce pod lors des
  modifications de modèle — il n'y a pas de risque de surcharge/blocage avec
  un seul réplica, mais l'augmentation de `max_instance_count` au-dessus de
  1 n'est pas prise en charge (voir Vue d'ensemble).
- **Inspectez le pod en cours d'exécution et ses données persistantes :**
  ```bash
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep APPSMITH
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées par leur balise `{{UIMeta group=N}}` telle que
déclarée dans le `variables.tf` de ce module (cela détermine la
disposition du formulaire d'interface utilisateur de la plateforme de
déploiement). Seuls les paramètres spécifiques ou notables pour Appsmith sont
listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `appsmith` | Nom de base pour la charge de travail Kubernetes, le dépôt Artifact Registry et les secrets Secret Manager. |
| `application_version` | `latest` | Balise appliquée à l'image `appsmith/appsmith-ce` tirée ; puisque l'image est pré-construite (pas une construction Dockerfile personnalisée), `latest` se résout directement à la balise `latest` de Docker Hub — aucun piège d'ARG de version-pin ne s'applique ici. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Tire l'image fat officielle `appsmith/appsmith-ce` de Docker Hub. Correctement transmise à la fondation App_GKE. |
| `container_port` | `80` | Appsmith CE sert sur le port 80 via son nginx interne. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=2Gi` | L'image fat regroupe MongoDB, Redis et un backend Java dans un seul conteneur, donc 2 Gi+ est recommandé. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Gardez les deux à 1.** Le MongoDB embarqué et le PVC par pod ne sont pas sûrs pour plusieurs réplicas ; `max_instance_count` n'est pas bloqué au-dessus de 1 au moment de la planification. |
| `enable_cloudsql_volume` | `false` | Toujours faux — Appsmith CE n'a pas de base de données Cloud SQL externe. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Docker Hub dans Artifact Registry avant le déploiement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur d'Appsmith. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement en StatefulSet car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Routage round-robin ; sans objet avec un seul réplica, mais laisser inchangé car `max_instance_count` doit rester à 1. |

### Groupe 13 — Système de fichiers (NFS) et jobs planifiés {#group-13--filesystem-nfs--scheduled-jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — la persistance utilise le PVC StatefulSet à la place. Activer uniquement si un volume Filestore partagé est préféré au PVC par pod. |
| `nfs_mount_path` | `/appsmith-stacks` | Chemin de montage utilisé si NFS est activé au lieu du PVC. |
| `initialization_jobs` / `cron_jobs` | `[]` | Pas de jobs par défaut — Appsmith CE s'auto-initialise. |

### Groupe 15 — Backend de base de données {#group-15--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Appsmith CE utilise un MongoDB embarqué ; aucune instance Cloud SQL n'est provisionnée. |
| `application_database_name` / `application_database_user` | `appsmith` | Non utilisé par Appsmith CE ; conservé uniquement pour la compatibilité de l'enveloppe. |

### Groupe 16 — Charge de travail avec état (PVC) {#group-16--stateful-workload-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne le PVC par pod qui supporte `/appsmith-stacks` (Mongo embarqué, Redis, téléchargements, configuration). Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC. Augmenter pour des bibliothèques de sources de données/applications plus grandes. |
| `stateful_pvc_mount_path` | `/appsmith-stacks` | Où tout l'état d'Appsmith est persisté. |
| `stateful_pvc_storage_class` | `""` → valeur par défaut du cluster (SSD `standard-rwo`) | Remplacer par `standard` (HDD) si le quota SSD régional est contraint. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (contrairement à la plupart des modules) — ajoutez un nom d'hôte à `application_domains` pour le router. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable lors des redéploiements. |

### Groupe 21 — Cloud Armor et Redis {#group-21--cloud-armor--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Laisser désactivé — Appsmith CE regroupe son propre Redis en interne et ne lit pas les variables d'environnement génériques `REDIS_HOST`/`REDIS_URL` que cela injecterait. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Appsmith. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Vide/non applicable — Appsmith CE n'a pas de base de données Cloud SQL externe (`database_type = NONE`). |
| `storage_buckets` | Buckets Cloud Storage créés (vides sauf si `storage_buckets` est renseigné par l'appelant). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration/importation fournis par l'appelant (vides par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `container_port` invalide, un conflit
> `StatefulSet`/`Deployment`, IAP activé sans
> identifiants OAuth, `quota_memory_*` donné comme des entiers nus. Ce
> module déclare également sa propre garde (`validation.tf`) :
> `min_instance_count ≤ max_instance_count`, IAP nécessitant les deux identifiants OAuth,
> `enable_cloudsql_volume` rejeté lorsque `database_type = "NONE"`, et
> `enable_redis` nécessitant un `redis_host` non vide. Une
> configuration invalide échoue la **planification** avec une erreur claire et
> nommée avant la création de toute ressource — mais notez que
> `max_instance_count > 1` n'est **pas** l'une des combinaisons gardées (voir
> ci-dessous).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Non bloqué au moment de la planification au-dessus de 1, mais chaque pod StatefulSet obtient son propre PVC **vide** — un deuxième réplica exécute un MongoDB embarqué divergent et non synchronisé sans clustering, corrompant l'hypothèse d'une source unique de vérité. |
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver supprime le PVC — tout l'état (Mongo embarqué, Redis, téléchargements, configuration d'application connectée à Git) devient éphémère et est perdu lors du redémarrage/replanification du pod. |
| `APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT` (auto-généré) | Ne jamais changer après le premier démarrage | Critique | La rotation de l'un ou l'autre indépendamment d'une réinitialisation complète des données rend les identifiants de source de données et les clés SSH Git précédemment chiffrés définitivement illisibles. |
| `database_type` | `NONE` | Critique | Appsmith CE n'a pas d'intégration de base de données externe ; la définition d'un moteur Cloud SQL provisionne une instance inutilisée et ne fait rien pour l'application. |
| `enable_cloudsql_volume` | `false` | Élevé | Bloqué au moment de la planification lorsque `database_type = "NONE"` — il n'y a pas d'instance Cloud SQL à proxifier. |
| `enable_redis` | `false` | Moyen | Appsmith CE regroupe Redis en interne et ne lit pas les variables d'environnement génériques `REDIS_HOST`/`REDIS_URL` que cela injecte — l'activer ajoute des variables d'environnement inertes et, si mal interprété comme une dépendance réelle, une fausse confiance dans un cache externe qui n'est pas utilisé. |
| `stateful_pvc_size` | `20Gi` (augmenter si nécessaire) | Moyen | Un sous-dimensionnement force une extension manuelle du PVC plus tard ; le Mongo embarqué et les actifs téléchargés partagent ce volume unique. |
| `startup_probe_config` timing | `initial_delay_seconds=120`, `failure_threshold=40` | Moyen | Le conteneur fat (Mongo + Redis + Java) démarre lentement ; une fenêtre plus courte peut signaler un pod sain mais toujours en démarrage comme échoué et déclencher une boucle de redémarrage. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et tout domaine personnalisé configuré. |
| `stateful_pvc_storage_class` | `""` (SSD) ou `standard` (HDD) | Faible–Moyen | Le SSD (`standard-rwo`) utilise le quota régional `SSD_TOTAL_GB` plus strict ; remplacer par HDD `standard` sur les projets à quota contraint — une application à pod unique n'a pas d'exigence d'IOPS qui nécessite un SSD. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Appsmith (secrets, valeurs par défaut d'environnement, câblage de sonde)
partagée avec la variante Cloud Run se trouve dans le module
`Appsmith_Common`.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Appsmith sur GKE Autopilot](../labs/Appsmith_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Appsmith Common — Configuration d'application partagée](Appsmith_Common.md) — la configuration partagée par les deux cibles de déploiement.
