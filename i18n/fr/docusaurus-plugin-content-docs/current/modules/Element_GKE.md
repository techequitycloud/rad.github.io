---
title: "Element sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Element sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Element_GKE.md @ e69407af sha256:959741f46566 -->

# Element sur GKE Autopilot {#element-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Element_GKE.png" alt="Element sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Element est le principal client web [Matrix](https://matrix.org/) open source (AGPLv3) — une application de messagerie et de collaboration auto-hébergée, chiffrée de bout en bout. Ce module déploie Element sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Element est une **application monopage (SPA) statique nginx** : le navigateur communique directement avec un homeserver Matrix (tel que Synapse ou Dendrite) via HTTPS, de sorte que le pod lui-même ne contient aucun état côté serveur — pas de base de données, pas de Redis, pas de volume persistant et pas de secrets.

Ce guide se concentre sur les services cloud qu'Element utilise et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls et le cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte Element sur RAD, et comment cela se compare {#what-element-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'Element sur RAD coûte environ 24,04 $ US par mois.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer le système d'exploitation, les correctifs de sécurité et les mises à niveau vous-même. Pour le coût le plus bas, le [guide Cloud Run](Element_CloudRun.md) exécute le même Element pour environ 16,78 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — études, démo, activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 24,04 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **24,04 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **55 crédits par jour**, soit environ 1 650 par mois (environ 165 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US lors d'une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 GiB | 18,04 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 24,04 $ US** |

### Comment cela se compare {#how-it-compares}

- Les niveaux payants d'Element (Enterprise, Sovereign) sont tarifés par siège ou par déploiement sans tarif publié, il n'y a donc rien à citer ici. Element est également exceptionnellement léger à auto-héberger, car c'est une application monopage statique sans base de données propre — même le plus petit et le moins cher des VPS le sert confortablement, bien en dessous de la classe de 2 vCPU à ~24 $/mois dont une application plus lourde a besoin.
- Le coût réel d'exécution de Matrix est presque entièrement celui du **homeserver** (Synapse ou Dendrite) auquel Element se connecte, qui est un déploiement séparé que ce module n'inclut pas.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Element s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Element dont vous n'avez besoin qu'occasionnellement — études, démo,
activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un module, cela ne supprime pas le pod GKE ou son réseau un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille d'Element, contre
  les 40 crédits (4,05 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 24,04 $ US.** Déployez Element, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Element était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD ne gère
  que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **La seule véritable lacune ailleurs ne s'applique pas ici.** Element ne conserve aucune donnée propre — pas de
  base de données, pas de compartiment de stockage — il n'y a donc rien à perdre lors de la restauration. Votre historique de conversation Matrix
  vit sur le homeserver vers lequel vous avez pointé Element, pas dans ce déploiement.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, le moyen d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 44 crédits
  (4,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Element. La suppression permet d'économiser de l'argent une fois qu'Element resterait inutilisé
  pendant environ **6 jours ou plus** dans votre propre projet (environ 0,80 $ US par jour), ou environ
  **1 jour ou plus** dans un projet géré par RAD (55 crédits par jour).
- **Supprimez tout ce qu'Element utilise.** Element ne contient aucun état côté serveur — pas de base de données, pas de stockage de fichiers — donc sa suppression arrête immédiatement tous ses propres coûts d'exécution, et il n'y a rien qu'il partage avec d'autres applications du projet à laisser en cours d'exécution.
- **Conservez d'abord vos données.** Element lui-même ne stocke rien à sauvegarder ; c'est un client sans état pointé vers un homeserver Matrix que vous exécutez séparément, donc la suppression du déploiement ne perd que sa propre configuration (règles d'ingress, domaines), pas l'historique des chats ou les données utilisateur.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez les
  paramètres à nouveau lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  Element dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur.
  Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Element pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Element s'exécute comme une charge de travail web nginx sans état. Le déploiement relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods SPA statiques nginx, 500m vCPU / 512 MiB par défaut, autoscaling horizontal |
| Build de conteneur | Cloud Build + Artifact Registry | Image personnalisée légère `FROM vectorim/element-web` avec un point d'entrée d'exécution `config.json` |
| Ingress | Cloud Load Balancing | Service External LoadBalancer, domaine personnalisé optionnel + certificat géré |
| Secrets | — | **Aucun.** Element ne nécessite aucun secret |
| Base de données | — | **Aucune.** Le homeserver Matrix détient tout l'état, pas Element |
| Stockage d'objets | — | **Aucun.** Element est sans état (pas de PVC, pas de bucket, pas de NFS) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Element est sans état.** Tout l'état du chat, les clés de chiffrement et les médias résident sur le
  homeserver Matrix et dans le navigateur de l'utilisateur. Element lui-même ne stocke rien
  côté serveur, donc la charge de travail est un simple `Deployment` sans base de données, Redis, PVC,
  bucket GCS ou secret Secret Manager.
- **Le homeserver est une configuration d'exécution.** `homeserver_url` / `homeserver_name`
  sont écrits dans `/app/config.json` par le point d'entrée du conteneur à chaque démarrage, de sorte
  qu'une image peut pointer vers n'importe quel homeserver sans reconstruction. Les laisser vides
  par défaut vers le public `matrix.org`.
- **Build personnalisé avec une version épinglée.** `container_image_source = "custom"` construit
  une image légère sur `vectorim/element-web`. `application_version = "latest"` résout
  vers le tag épinglé connu `v1.11.86` via un ARG de build `ELEMENT_VERSION` spécifique à l'application.
  `App_GKE` définit `imagePullPolicy=Always` pour le tag personnalisé réutilisé afin que les reconstructions
  soient réellement tirées.
- **Un minimum de 1 réplica est maintenu** (GKE ne se met pas à l'échelle à zéro) afin que l'interface utilisateur du client
  soit toujours accessible. Aucune affinité de session n'est nécessaire car Element est sans état.
- **Port 80.** nginx sert la SPA sur le port 80 ; les sondes ciblent `/`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Element {#a-gke-autopilot--the-element-workload}

Les pods Element sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Element pour voir
  les pods et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment vs StatefulSet) sont gérés.

### B. Image de conteneur — Cloud Build et Artifact Registry {#b-container-image--cloud-build--artifact-registry}

L'image Element est construite par Cloud Build à partir d'un Dockerfile léger qui superpose un
point d'entrée générant `config.json` sur `vectorim/element-web`, puis poussée vers
Artifact Registry. `application_version = "latest"` construit le `v1.11.86` épinglé.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le pipeline de build, la mise en miroir d'images et le
comportement `imagePullPolicy=Always` pour les tags personnalisés réutilisés.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique est réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### D. Identity-Aware Proxy (facultatif) {#d-identity-aware-proxy-optional}

Element est livré ouvert par défaut afin que les utilisateurs puissent se connecter au homeserver. Pour restreindre
qui peut même charger l'interface utilisateur du client à vos identités Google, activez IAP
(`enable_iap = true`) avec un client OAuth.

- **Console :** Sécurité → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le câblage IAP + BackendConfig.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (journaux d'accès/erreurs nginx) sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées
vers Cloud Monitoring. Des vérifications de disponibilité et des stratégies d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Element {#3-element-application-behaviour}

- **Génération de la configuration d'exécution.** Le point d'entrée du conteneur écrit `/app/config.json`
  à chaque démarrage à partir de `HOMESERVER_URL` / `HOMESERVER_NAME`, puis passe la main à nginx.
  Changer le homeserver est un redéploiement avec de nouvelles valeurs d'environnement — pas de reconstruction d'image.
- **Pas de base de données, pas de migrations, pas de job d'initialisation.** Element sert des actifs statiques ; le pod
  est Prêt dès que nginx lie le port 80.
- **La connexion est un flux navigateur-vers-homeserver.** Element authentifie l'utilisateur directement
  contre le homeserver Matrix configuré ; il n'y a pas de session côté serveur dans le pod
  et rien à amorcer dans Secret Manager.
- **Vérifiez le homeserver injecté.** Confirmez que l'environnement du pod en cours d'exécution correspond à votre
  homeserver prévu, et que le LoadBalancer répond :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep HOMESERVER
  kubectl get svc -n "$NAMESPACE" <service-name> -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
  Alors `curl -s http://<external-ip>/config.json` devrait renvoyer le JSON avec votre
  `base_url`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, auquel nginx répond
  immédiatement et sans authentification.
- **Mise à niveau d'Element.** Augmentez `application_version` (ou épinglez un tag `element-web` plus récent)
  et redéployez ; une nouvelle image est construite et, parce que `imagePullPolicy=Always` est défini pour
  le tag personnalisé réutilisé, le déploiement tire les nouvelles couches.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Element sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `element` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Element ; `latest` construit le `v1.11.86` épinglé. Épinglez un tag `element-web` spécifique en production. |
| `homeserver_url` | `""` | URL de base du homeserver Matrix écrite dans `config.json`. Vide → `matrix.org`. |
| `homeserver_name` | `""` | Nom du serveur Matrix (identité de délégation) annoncé par Element. Vide → `matrix.org`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image Element légère via Cloud Build. |
| `container_image` | `""` | Remplacez par un URI d'image pré-construite/mise en miroir. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE ne se met pas à l'échelle à zéro. |
| `max_instance_count` | `3` | Réplicas maximum. |
| `container_port` | `80` | nginx écoute sur le port 80. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | Limites CPU/mémoire — Element est léger. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — le sidecar Auth Proxy n'est pas déployé. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires fusionnés avec les `HOMESERVER_URL` / `HOMESERVER_NAME` injectés. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Element n'en a pas besoin. |
| `secret_rotation_period` / `secret_propagation_delay` | _(défini)_ | Notification de rotation / attente de propagation. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Element est sans état ; le socle résout automatiquement cela en un Deployment. |
| `session_affinity` | `None` | Pas de routage persistant nécessaire — Element ne contient aucune session côté serveur. |
| `namespace_name` | `""` | Espace de noms pour la charge de travail ; vide signifie auto-dérivé du nom du service. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Hérité et **non utilisé par Element** (déploiement sans état). `stateful_pvc_enabled`
(par défaut `null`), `stateful_pvc_size`, `stateful_pvc_mount_path`,
`stateful_pvc_storage_class`, `stateful_headless_service`,
`stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group`.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | _(défini)_ | Quota CPU de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | _(défini)_ | Quota mémoire de l'espace de noms. **Doit utiliser des unités binaires** (`4Gi`, `8192Mi`). |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | _(défini)_ | Limites d'objets de l'espace de noms. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | _(défini)_ | Répartir les pods sur les zones/nœuds. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 10 s de délai, 6 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/` 15 s de délai | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | _(défini)_ | Sondes d'infrastructure au niveau App_GKE. |
| `uptime_check_config` | désactivé — `/` | Vérification de disponibilité Cloud Monitoring facultative ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Element ne déclare aucun job d'initialisation. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

Hérité et **désactivé par défaut** — Element est sans état. `enable_nfs` (`false`),
`nfs_mount_path`, `nfs_volume_name`, `nfs_instance_name`, `nfs_instance_base_name`.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Créer des buckets GCS définis dans `storage_buckets`. Désactivé — Element est sans état et n'en déclare aucun. |
| `storage_buckets` | `[]` | Buckets supplémentaires. Element n'en déclare aucun. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

Hérité de [App_GKE](App_GKE.md) et **inerte** — une SPA statique n'a pas de cache ou de file d'attente côté serveur. `enable_redis`, `redis_host`, `redis_port`, `redis_auth`.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Hérité de [App_GKE](App_GKE.md) et **inerte** — `Element_Common` définit
`database_type = "NONE"`. Aucune instance Cloud SQL, utilisateur ou mot de passe n'est créé.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

Hérité et **sans effet pour Element** (rien à sauvegarder). `backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`.

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Hérité ; non utilisé par Element. `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `static_ip_name` / `network_tags` / `network_name` | _(défini)_ | Nom IP, tags de nœud, réseau VPC. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Note :** L'activation d'IAP nécessite une authentification par identité Google avant même le chargement de l'interface utilisateur du client. Les utilisateurs s'authentifient toujours auprès du homeserver par la suite ; IAP est une passerelle d'accès externe, pas un remplacement de la connexion Matrix.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Element. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE — utile pour les actifs statiques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Element. |
| `storage_buckets` | Buckets Cloud Storage créés (vides pour Element). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (aucun pour Element). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, une charge de travail `Deployment` avec `stateful_pvc_enabled = true`, des valeurs `quota_memory_*` entières brutes. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `homeserver_url` / `homeserver_name` | Votre vrai homeserver, ou vide pour matrix.org | Élevé | Un homeserver erroné ou inaccessible empêche les utilisateurs de se connecter — l'interface utilisateur se charge mais l'authentification échoue. |
| `application_version` | Épinglez un vrai tag `element-web` | Élevé | `latest` n'est pas un tag `element-web` valide ; le module épingle `v1.11.86`, mais un ARG de build `latest` brut défini manuellement échouerait avec `MANIFEST_UNKNOWN`. |
| `container_image_source` | `custom` | Élevé | `prebuilt` avec une image sans le point d'entrée `config.json` déploie Element pointant vers le mauvais homeserver. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. Maintenir 1 assure que l'interface utilisateur est toujours accessible. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_iap` | Activer pour protéger l'interface utilisateur | Moyen | Sans IAP, toute personne ayant l'URL peut charger le client (elle a toujours besoin des identifiants du homeserver pour se connecter). |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| Entrées Base de données / Redis / Sauvegarde / NFS | Laisser par défaut | Faible | Inertes pour Element ; les définir n'a aucun effet. |

---

Pour le comportement du socle référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Element
partagée avec la variante Cloud Run est décrite dans
**[Element_Common](Element_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Element sur GKE Autopilot](../labs/Element_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Element sur Google Cloud Run](Element_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Element Common — Configuration d'application partagée](Element_Common.md) — la configuration partagée par les deux cibles de déploiement.
