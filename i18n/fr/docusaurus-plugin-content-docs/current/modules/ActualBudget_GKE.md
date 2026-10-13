---
title: "ActualBudget sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'ActualBudget sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ActualBudget_GKE.md @ e69407af sha256:9debad22ca20 -->

# ActualBudget sur GKE Autopilot {#actualbudget-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ActualBudget_GKE.png" alt="ActualBudget sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Actual Budget est une application de finances personnelles axée sur la confidentialité et le
local-first, construite autour de la budgétisation par enveloppes à base zéro. Le composant
`actual-server` est un serveur de synchronisation Node.js léger qui stocke chaque budget sous forme de
fichier SQLite et le synchronise entre l'interface web, les clients de bureau et mobiles. Ce
module déploie ActualBudget sur **GKE Autopilot** en tant que **StatefulSet** avec un PVC de
bloc par pod, sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par ActualBudget et sur la manière de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes
et le cycle de vie du déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte ActualBudget sur RAD, et comment cela se compare {#what-actualbudget-costs-on-rad-and-how-that-compares}

**Le module ActualBudget sur GKE Autopilot de RAD coûte environ 42 $ US par mois dans un
projet que vous possédez, sans frais de licence pour le logiciel lui-même.** RAD facture des
frais de module uniques de 75 crédits (7,50 $ US au prix de la recharge) dans un projet que
vous possédez, et 67,5 crédits (10 % de moins) dans un projet géré par RAD. GKE convient à
ActualBudget qui doit rester opérationnel en continu ou s'adapter à plusieurs pods ; pour le
coût le plus bas, le [module Cloud Run](ActualBudget_CloudRun.md) exécute le même ActualBudget
pour environ 19 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources
sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo,
un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30
jours pour une poignée de crédits, de sorte que les quelque 42 $ US par mois deviennent
presque rien. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits, facturés à la minute de temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 42 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 $ US au prix de la recharge, 161 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 $ US (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 42 $ US** |

### Comment cela se compare {#how-it-compares}

- YNAB (You Need A Budget), l'application de budgétisation payante la plus connue dans la même
  catégorie, facture **14,99 $/mois** (ou 109 $/an, soit environ 9,08 $/mois) par personne — et
  il s'agit uniquement de frais de licence pour le logiciel, sans infrastructure propre
  derrière.
- **RAD exécute le projet open source lui-même, et non une location hébergée par un
  fournisseur.** Vous obtenez le même logiciel, sur votre propre infrastructure (ou celle de
  RAD), au lieu d'un abonnement par siège ou par utilisation qui augmente indépendamment de ce
  que vous utilisez réellement.
- **Par rapport à un serveur autogéré nu :** Il s'agit d'une charge de travail plus petite
  qu'un VPS standard de 2 vCPU, donc l'exécuter vous-même sur une classe moins chère et plus
  petite qu'un Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go Droplet (tous deux environ 24 $/mois)
  suffirait, pour nettement moins que cela. RAD n'est pas moins cher en termes monétaires — la
  différence est la base de données gérée, Secret Manager et la surveillance qui sont inclus
  avec le module au lieu d'être votre propre travail.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si ActualBudget s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui
va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet, et le
restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation
occasionnelle — pour préparer une certification, une démo, un besoin saisonnier — que
d'exécuter ActualBudget en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation,
  puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime
  pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la
  facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la
  suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource
  de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé
  entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours,
  seul le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le
  projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update**
  sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — il s'agit
  d'une vérification, pas d'une reconstruction, et une mise à jour ne facture jamais les
  frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $
  US), contre le paiement des frais de module et une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère
  uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après
  cela, Google le supprime définitivement — et la restauration est admise comme la création
  d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le seuil du
  palier (100 crédits pour le palier sandbox, ce qui convient à la plupart des utilisations
  d'étude et de démo). Google indique que la plupart des services sont à nouveau pleinement
  opérationnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'ActualBudget écrit
  dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que
  vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — ce
  bucket a la suppression logicielle de Cloud Storage explicitement désactivée. Quiconque a
  personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de
restauration de 30 jours ci-dessus est passée : **supprimer le déploiement, et le redéployer
lorsque vous en avez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds :
  environ 80 crédits (environ 8 $ US) dans votre propre projet, ou 72,5 crédits dans un projet
  géré par RAD, car RAD reconstruit les ressources à partir de zéro. La suppression permet
  d'économiser de l'argent une fois qu'ActualBudget resterait inutilisé assez longtemps pour
  compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ 6
  jours ou plus dans votre propre projet (1,40 $ US/jour) ou 1 jour ou plus dans un projet
  géré par RAD (67 crédits/jour).
- **Le cluster GKE lui-même est une infrastructure partagée.** Si une autre application
  utilise le même cluster Autopilot, la suppression d'ActualBudget seule ne sauve que son
  propre pod ; les frais de gestion du cluster ne diminuent que si rien d'autre dans le
  projet n'en a besoin.
- **Gardez vos données en premier.** Tout ce qu'ActualBudget écrit dans un bucket de
  sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière
  sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de supprimer si vous
  voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les
  paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe.
  Chaque participant reçoit ActualBudget dans son propre projet Google Cloud pendant 15
  minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le
  formateur finance toutes les places, soit chaque participant paie la sienne. Tout est
  supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute ActualBudget
  pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec
  le client. Si le portefeuille est faible, la facturation est suspendue et les données sont
  conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing)
; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes de pause/restauration ; [Tarifs YNAB](https://www.ynab.com/pricing). Les
prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

ActualBudget s'exécute comme une seule charge de travail Node.js `actual-server`. Parce qu'il gère son
propre stockage SQLite, le déploiement relie un ensemble délibérément restreint de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods `actual-server`, 1 vCPU / 1 GiB par défaut, réplica unique (`min = max = 1`) exécuté en tant que **StatefulSet** |
| Base de données | Aucune | Les budgets sont des fichiers SQLite sous `/data` — `database_type = "NONE"` est fixé par `ActualBudget_Common` ; aucune instance Cloud SQL n'est créée |
| Stockage persistant | PVC Kubernetes (volume de bloc par pod) | `stateful_pvc_enabled = true` par défaut — un PVC `standard-rwo` de 20 Gi monté à `/data` (SQLite a besoin d'un stockage de bloc, pas de GCS FUSE) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est toujours déclaré par `ActualBudget_Common` ; il ne se monte à `/data` (via GCS FUSE) que lorsque le PVC de bloc est désactivé |
| Secrets | Secret Manager | Optionnel — un jeton API de 32 caractères (`enable_api_key`, par défaut `false`) injecté en tant que `ACTUAL_TOKEN` via un Secret Kubernetes natif |
| Ingress | Service Kubernetes / API Gateway | Par défaut à `service_type = ClusterIP` avec `enable_custom_domain = true` mais aucun domaine configuré — interne uniquement jusqu'à ce que vous ajoutiez un LoadBalancer ou un domaine |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **StatefulSet + PVC de bloc par défaut.** `stateful_pvc_enabled = true` résout automatiquement `workload_type` en
  `StatefulSet` (pas besoin de définir les deux) et monte un PVC `standard-rwo` de 20 Gi à `/data`
  avec `fsGroup = 3000`, correspondant à la convention du graphique Helm d'ActualBudget afin que le
  conteneur (UID 1000/GID 2000) puisse écrire sur le volume. Cela est délibérément préféré à
  GCS FUSE car SQLite ne tolère pas bien un répertoire monté par FUSE.
- **Pas de base de données du tout.** `database_type` est fixé à `NONE` par `ActualBudget_Common` ; il n'y
  a pas d'instance Cloud SQL, pas de job `db-init`, et `enable_cloudsql_volume` par défaut `false` (pas de
  sidecar Cloud SQL Auth Proxy).
- **Redis est désactivé en dur, pas seulement désactivé par défaut.** Le `main.tf` de la
  variante passe `enable_redis = false` à la fondation App_GKE inconditionnellement — il ne transmet **pas**
  `var.enable_redis` — donc ActualBudget ne reçoit jamais de `REDIS_HOST` sur GKE, quelle que soit la
  valeur de cette variable.
- **Réplica unique par conception.** `min_instance_count = 1` et `max_instance_count = 1` — le serveur suppose un accès
  exclusif à ses fichiers SQLite sur le PVC partagé.
- **`container_port` est fixé à `5006`** par `ActualBudget_Common` quelle que soit la valeur propre de la
  variable `container_port` — cette variable est inerte (son texte de description/validation fait
  référence à un `6333` obsolète, un artefact de copier-coller inoffensif d'un autre
  module).
- **Pas de génération d'administrateur/secret.** Le mot de passe du serveur est défini
  interactivement sur l'écran d'intégration de la première exécution — il n'y a pas de
  crédentiel pré-rempli à récupérer, sauf si `enable_api_key =
  true` génère un `ACTUAL_TOKEN`.
- **Les sondes de santé ciblent `/`** — HTTP `GET /` renvoie 200 dès que le serveur
  Node écoute, aucune authentification requise.
- **L'exposition prête à l'emploi est interne uniquement.** `service_type` par défaut à `ClusterIP`
  (pas `LoadBalancer`, contrairement à la plupart des modules d'application GKE) et `enable_custom_domain` par
  défaut à `true` mais `application_domains` par défaut à `[]` — donc un nouveau
  déploiement n'a pas de point de terminaison externe accessible tant que vous ne définissez
  pas `service_type = LoadBalancer` ou ne fournissez pas `application_domains` (plus DNS).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et
`NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont signalés dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet ActualBudget {#a-gke-autopilot--the-actualbudget-statefulset}

ActualBudget s'exécute en tant que StatefulSet à réplica unique, ce qui donne à son pod une
identité stable (`<statefulset-name>-0`) et réaffecte le même PVC lors des redémarrages et des mises à jour.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  ActualBudget pour les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Déploiement vs StatefulSet).

### B. Volumes persistants — le PVC de bloc `/data` {#b-persistent-volumes--the-data-block-pvc}

Avec `stateful_pvc_enabled = true` (par défaut), un PersistentVolumeClaim par pod est provisionné et monté à
`/data`, où `actual-server` écrit ses bases de données SQLite de budget, ses fichiers
serveur et ses fichiers utilisateur. La StorageClass `standard-rwo` par défaut est basée sur SSD
(Balanced PD) et utilise le quota régional (souvent serré) `SSD_TOTAL_GB`.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- df -h /data
  ```

### C. Cloud Storage — le bucket `storage` (solution de repli GCS FUSE) {#c-cloud-storage--the-storage-bucket-gcs-fuse-fallback}

`ActualBudget_Common` déclare toujours un bucket Cloud Storage (`storage`), mais il n'est monté à
`/data` via GCS FUSE que lorsque le PVC de bloc est désactivé (`stateful_pvc_enabled = false`). Avec le
PVC StatefulSet par défaut en place, ce bucket existe mais n'est pas monté.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
  ```

Voir [App_GKE](App_GKE.md) pour le comportement de montage GCS Fuse et les options CMEK.

### D. Secret Manager — jeton API optionnel {#d-secret-manager--optional-api-token}

Par défaut, aucun secret n'est créé. Lorsque `enable_api_key = true`, un jeton aléatoire de 32 caractères
est généré, stocké dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key`, et injecté dans le pod en tant
que variable d'environnement `ACTUAL_TOKEN` via un Secret Kubernetes natif — utile pour les
automatisations qui doivent appeler le serveur avant que l'interface utilisateur ne soit
configurée.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

La charge de travail est par défaut `service_type = ClusterIP` — aucune IP externe n'est créée
prête à l'emploi. `enable_custom_domain = true` provisionne une ressource Kubernetes Gateway API, mais avec
`application_domains = []` par défaut, il n'y a pas de noms d'hôte à router. Définissez `service_type = LoadBalancer` pour
une IP externe directe, ou renseignez `application_domains` (avec DNS pointant vers l'IP
résultante) pour une Gateway de domaine personnalisé avec un certificat géré.

- **Console :** Kubernetes Engine → Services et Ingress ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP
statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE
sont acheminées vers Cloud Monitoring. Un test de disponibilité optionnel (`uptime_check_config`,
désactivé par défaut) nécessite un point de terminaison publiquement accessible, ce que le
paramètre par défaut `ClusterIP` ne fournit pas.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ActualBudget {#3-actualbudget-application-behaviour}

- **Pas de job d'initialisation.** Il n'y a pas de base de données à amorcer ; le serveur
  crée ses fichiers SQLite sous `/data` au premier démarrage. Des `initialization_jobs`
  personnalisés sont acceptés pour les tâches de chargement ou de migration de données, mais
  aucun n'est fourni par défaut.
- **Configuration initiale.** Lors du premier accès, l'interface web affiche un écran
  d'intégration où vous définissez le **mot de passe du serveur** — il n'y a pas de
  crédentiels pré-remplis à récupérer. Faites-le immédiatement après avoir rendu le service
  accessible ; tant qu'un mot de passe n'est pas défini, toute personne pouvant atteindre
  l'URL peut s'approprier le serveur.
- **Disposition des données.** `ACTUAL_SERVER_FILES = /data/server-files` (métadonnées du serveur et base de données du
  compte) et `ACTUAL_USER_FILES = /data/user-files` (données de synchronisation par budget), tous deux sur le montage
  persistant `/data` (PVC par défaut).
- **Modèle de synchronisation local-first.** Les clients (web, bureau, mobile) conservent une
  copie locale complète du budget et n'utilisent le serveur que pour synchroniser les
  modifications chiffrées entre les appareils — une brève indisponibilité du serveur ne
  bloque pas le travail dans un client.
- **Contrainte d'écrivain unique, mises à jour sécurisées de StatefulSet.** Le serveur
  suppose un accès exclusif à ses fichiers SQLite ; maintenez `max_instance_count = 1`. Étant donné que la
  charge de travail est un StatefulSet avec une identité stable par pod liée au même PVC, la
  stratégie `RollingUpdate` par défaut remplace le pod unique en place plutôt que de faire monter
  en puissance un deuxième pod contre le volume partagé — contrairement aux combinaisons
  Déploiement+NFS utilisées par d'autres modules de ce dépôt, il n'y a pas de risque de
  blocage par double montage ici.
- **Précedence des sondes.** `startup_probe_config` et `health_check_config` (les variables de sonde
  App_GKE génériques de haut niveau) sont **inertes** pour ActualBudget — la configuration
  effective de la sonde provient toujours des propres variables `startup_probe` / `liveness_probe`
  d'ActualBudget (transmises via la sortie `ActualBudget_Common` de `config`), toutes deux
  ciblant HTTP `GET /` non authentifié.
- **Mises à jour de version.** Changez `application_version` et réappliquez — Cloud Build produit une
  nouvelle image et le StatefulSet déploie la nouvelle révision. `latest` construit le
  `25.7.1` épinglé via l'ARG de build `ACTUALBUDGET_VERSION` spécifique à l'application (pas le
  `APP_VERSION` générique injecté par la fondation).
- **Chemin de santé.** Sonde de démarrage : HTTP `GET /`, délai initial de 15s, timeout de
  10s, période de 10s, 10 échecs autorisés. Sonde de vivacité : HTTP `GET /`, délai
  initial de 30s, timeout de 5s, période de 30s, 3 échecs autorisés. Les deux renvoient 200
  non authentifié dès que le serveur HTTP écoute.
- **Vérification :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
  kubectl port-forward -n "$NAMESPACE" "$POD" 5006:5006 &
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5006/   # expect 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour ActualBudget sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement et ses
valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `actualbudget` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` construit le `25.7.1` épinglé. |
| `enable_api_key` | `false` | Génère un jeton API de 32 caractères dans Secret Manager et l'injecte en tant que `ACTUAL_TOKEN`. Recommandé pour tout déploiement accessible en dehors du pod/namespace. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | `actual-server` est un processus Node.js léger ; 1 vCPU suffit. |
| `memory_limit` | `1Gi` | Une mémoire modeste suffit pour les fichiers de budget typiques. |
| `min_instance_count` | `1` | Maintient l'instance unique active et évite les démarrages à froid. |
| `max_instance_count` | `1` | **Maintenir à 1** — un volume SQLite partagé, un seul écrivain. |
| `container_port` | `5006` | Inerte — `ActualBudget_Common` définit toujours le port du conteneur à `5006`. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — laisser `false`. |
| `enable_image_mirroring` | `true` | Met en miroir `actualbudget/actual-server` dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessible en externe par défaut, conformément à tous les autres modules d'application GKE orientés navigateur. Définissez `ClusterIP` pour le maintenir interne uniquement. |
| `workload_type` | `null` → `StatefulSet` | Résolution automatique car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | Pas de routage persistant configuré (le réplica unique rend cela largement inutile). |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Activé par défaut (contrairement à la plupart des modules) — les bases de données SQLite de budget et les fichiers utilisateur de `actual-server` nécessitent un stockage de bloc, pas GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; taille pour les bases de données et les fichiers de budget plus les frais généraux. |
| `stateful_pvc_mount_path` | `/data` | Où `actual-server` persiste sa base de données SQLite, ses fichiers serveur et ses fichiers utilisateur. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré basé sur SSD ; utilise le quota `SSD_TOTAL_GB` — remplacer par `standard` (HDD) si ce quota est serré. |
| `stateful_fs_group` | `3000` | Correspond à la convention `fsGroup` du graphique Helm d'ActualBudget afin que le conteneur (UID 1000/GID 2000) puisse écrire sur le PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut (contrairement à la plupart des modules) — protège le réplica StatefulSet unique lors d'une perturbation volontaire du nœud. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles lors de perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 15s, 10 échecs | La sonde de démarrage **effective** (voir §3 "Précedence des sondes"). |
| `liveness_probe` | HTTP `/`, délai initial de 30s, 3 échecs | La sonde de vivacité **effective**. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Déclaré pour la mise en miroir des variables de fondation mais **inerte** pour ActualBudget — utilisez `startup_probe` / `liveness_probe` ci-dessus à la place. |
| `uptime_check_config` | désactivé | N'activer que lorsque le point de terminaison est publiquement accessible (`LoadBalancer` ou un domaine personnalisé). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée toujours le bucket `storage` que `ActualBudget_Common` déclare. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le bucket `storage` ne se monte automatiquement à `/data` que lorsque `stateful_pvc_enabled = false`. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) | **N'a aucun effet** — `main.tf` code en dur `enable_redis = false` à la fondation quelle que soit la valeur de cette variable. |
| `redis_host` / `redis_port` / `redis_auth` | inerte | Non applicable — ActualBudget n'a pas d'intégration Redis sur GKE. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` (fixe) | `ActualBudget_Common` fixe cela à `NONE` ; aucune instance Cloud SQL n'est créée quelle que soit cette variable. |
| `application_database_name` / `application_database_user` | `actualbudgetdb` / `actualbudgetuser` | Transmis uniquement pour la compatibilité de la fondation — non référencé (aucune base de données n'existe). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut, mais avec `application_domains = []` la Gateway n'a pas de noms d'hôte à router tant que vous n'en fournissez pas un. |
| `application_domains` | `[]` | Renseignez pour exposer ActualBudget via un domaine personnalisé + certificat géré. |
| `reserve_static_ip` | `true` | Réserve une IP statique même si `service_type` par défaut à `ClusterIP` (aucune IP LoadBalancer n'est allouée par défaut). |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée). |
| `service_url` | URL pour atteindre ActualBudget. |
| `actualbudget_api_key_secret_id` | ID du secret Secret Manager pour la clé API. Vide lorsque `enable_api_key = false`. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au
> moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans
> identités autorisées, `quota_memory_*` donné comme des entiers nus, un `container_port`/`backup_retention_days` hors
> limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Plusieurs pods écrivant les mêmes fichiers SQLite sur un volume partagé risquent une corruption/des conflits d'écriture. |
| Mot de passe du serveur à la première exécution | défini immédiatement | Critique | Tant qu'un mot de passe n'est pas défini, toute personne pouvant atteindre le service peut s'approprier le serveur et ses données de budget. |
| Contenu du PVC `/data` | ne jamais supprimer manuellement | Critique | Le PVC de bloc est la seule copie des bases de données de budget ; sa suppression efface tous les budgets. |
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver revient à utiliser GCS FUSE à `/data`, qui ne tolère pas SQLite sous une forte écriture concurrente. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont traités comme des octets et bloquent toute planification de pod. |
| `service_type` / `application_domains` | définir l'un pour exposer en externe | Élevé | Avec les valeurs par défaut (`ClusterIP` + pas de domaines), le service n'est accessible que depuis l'intérieur du cluster. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Moyen | Utilise le quota serré `SSD_TOTAL_GB` ; remplacer par `standard` (HDD) sur un projet contraint par le quota — SQLite n'a pas besoin d'IOPS SSD. |
| `enable_redis` | toute valeur — **inerte** | Faible | Tenter d'activer Redis via cette variable n'a aucun effet sur GKE ; `main.tf` le désactive toujours. |
| `container_port` | `5006` (fixe) | Faible | La variable est inerte ; sa propre description/validation fait référence à un numéro de port obsolète et sans rapport. |
| `startup_probe_config` / `health_check_config` | toute valeur — **inerte** | Faible | Utilisez `startup_probe` / `liveness_probe` à la place pour modifier le timing de la sonde ; ces deux-là sont ignorés pour ActualBudget. |
| `enable_api_key` | `true` pour l'automatisation sur un point de terminaison accessible | Moyen | Sans `ACTUAL_TOKEN`, l'accès API programmatique repose uniquement sur le mot de passe du serveur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à ActualBudget partagée avec la variante Cloud Run est décrite dans
**[ActualBudget_Common](ActualBudget_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : ActualBudget sur GKE Autopilot](../labs/ActualBudget_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [ActualBudget Common — Configuration d'application partagée](ActualBudget_Common.md) — la configuration partagée par les deux cibles de déploiement.
