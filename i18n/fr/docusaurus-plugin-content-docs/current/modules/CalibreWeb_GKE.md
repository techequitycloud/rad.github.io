---
title: "Calibre-Web sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Calibre-Web sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CalibreWeb_GKE.md @ e69407af sha256:fed83789e3b6 -->

# Calibre-Web sur GKE Autopilot {#calibre-web-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalibreWeb_GKE.png" alt="Calibre-Web sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Calibre-Web est une application web propre, auto-hébergée, pour parcourir, lire et
télécharger des livres électroniques à partir d'une bibliothèque Calibre existante. Elle
offre un lecteur intégré au navigateur, un flux OPDS, la gestion des utilisateurs
et la synchronisation Kobo, en plus de l'image LinuxServer.io `calibre-web`
en amont. Ce module déploie Calibre-Web sur **GKE Autopilot** au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée Google Cloud et Kubernetes ; `CalibreWeb_GKE` est un wrapper léger qui
fournit la propre configuration de Calibre-Web (image, ports, sondes, câblage du stockage) et
transmet tout le reste directement.

Ce guide se concentre sur les services cloud utilisés par Calibre-Web et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Coût de Calibre-Web sur RAD et comparaison {#what-calibre-web-costs-on-rad-and-how-that-compares}

**Calibre-Web sur le module GKE Autopilot de RAD coûte environ 42 US$ par mois dans votre propre projet Google Cloud, sans frais de licence supplémentaires** — Calibre-Web est open source. Dans un projet géré par RAD pour vous, le même déploiement est facturé à **67 crédits par jour** (environ 2 010 par mois, soit environ 201 US$ au prix de la recharge). Ou consultez le [guide Cloud Run](CalibreWeb_CloudRun.md) pour l'option à moindre coût. Si vous n'avez besoin de Calibre-Web qu'occasionnellement — pour des études, une démo, un projet de courte durée — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Calibre-Web est open source, il n'y a donc pas de frais de licence. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6 crédits) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total (hors frais de cluster GKE partagé)** | **environ 42 US$** |

Ces prix sont les mêmes en africa-south1 (Johannesburg).

- **GKE Autopilot ne se met pas à l'échelle zéro.** Au moins un pod est toujours en cours d'exécution, de sorte que le coût ci-dessus s'applique que l'application soit utilisée ou non ; des pods supplémentaires ne sont ajoutés qu'en cas de charge.

### Comparaison pour un serveur de livres électroniques personnel ou pour petite bibliothèque {#how-it-compares-for-a-personal-or-small-library-ebook-server}

Calibre-Web n'a pas d'offre hébergée officielle — il est conçu pour fonctionner avec votre propre bibliothèque Calibre existante, la comparaison réaliste est donc un serveur nu :

- Un droplet Hetzner CPX22 ou DigitalOcean (2 vCPU/4 Go, environ 24 US$/mois) ou un GCP e2-standard-2 (2 vCPU/8 Go, environ 49 US$/mois) le ferait fonctionner confortablement — surdimensionné pour l'empreinte 1 vCPU/1 Gio de Calibre-Web ici, donc une classe d'instance plus petite et moins chère ferait tout aussi bien l'affaire.
- Sur un VPS nu, vous possédez le système d'exploitation, les correctifs de sécurité et votre propre discipline de sauvegarde. Le module de RAD vous offre le calcul, Secret Manager et Cloud Monitoring déjà câblés, pour les frais de module plus l'utilisation de Google Cloud ci-dessus.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Calibre-Web s'exécute dans **un projet géré par RAD pour vous**, la suppression de l'ensemble du projet — plutôt que la suppression
de ce seul module — délie d'abord sa facturation, puis demande à Google de supprimer
définitivement le projet. Google le conserve, récupérable, pendant 30 jours, et comme la facturation
est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module,
cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut demander à Google de récupérer le projet et de rattacher son compte de facturation, puis d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes, et une mise à jour ne facture plus les frais de module. Pour une chaîne de déploiement typique de 2 à 3 déploiements, cela ne coûte qu'une poignée de crédits au total (environ 5 à 10 crédits, moins de 1 US$).
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et franchir à nouveau le seuil d'admission du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage désactivée, il est donc très probable qu'il disparaisse dès que le projet est supprimé — même si le projet lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de la supprimer s'il y a quelque chose d'important à conserver ; pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 79 crédits
  (environ 7,90 US$) au prix de la recharge, et environ 15 à 20 minutes de temps de build (moyenne de la
  plateforme RAD). La suppression ne permet d'économiser de l'argent que si Calibre-Web resterait
  inutilisé pendant environ **3 jours ou plus** — dans votre propre projet, cela représente environ 1,40 US$ par jour, et
  dans un projet géré par RAD, c'est 67 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Calibre-Web alors qu'une autre application partage le projet n'économise que la partie calcul de Calibre-Web.
- **Conserver les données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc
  copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte,
virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et la mise en garde concernant le bucket de sauvegarde ; les prix changent, vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Calibre-Web s'exécute comme une charge de travail unique et stateful. Il n'a **pas de base de données externe** —
tout son état (la base de données de l'application, la base de données des métadonnées de la bibliothèque Calibre,
la configuration, le cache et les journaux) réside dans des fichiers SQLite internes sous `/config`. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Calibre-Web sur le port 8083, 1 vCPU / 1 Gio par défaut |
| Type de charge de travail | Kubernetes **StatefulSet** | Sélectionné automatiquement car `stateful_pvc_enabled = true` par défaut |
| Persistance de la configuration/bibliothèque | **Volume persistant de bloc** GKE (`standard-rwo`, basé sur SSD) | Monté à `/config` ; contient `app.db`, `metadata.db` de Calibre, la configuration, le cache, les journaux |
| Stockage d'objets | Cloud Storage | Un bucket suffixé `storage` est toujours provisionné, mais n'est **pas monté** tant que le PVC du StatefulSet est utilisé (voir §2.C) |
| Secrets | Secret Manager | `CALIBRE_ADMIN_PASSWORD` auto-généré — provisionné mais **pas** le credential avec lequel Calibre-Web s'authentifie réellement lors de la première connexion (voir §3) |
| Base de données | Aucune | `database_type = "NONE"` ; pas d'instance Cloud SQL, d'utilisateur ou de job `db-init` |
| Ingress | API Kubernetes Gateway (lorsqu'un domaine personnalisé est configuré) ou `ClusterIP` intra-cluster | `service_type` par défaut à `ClusterIP`, **pas** `LoadBalancer` (voir §2.E) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Stateful, soutenu par PVC par défaut.** `stateful_pvc_enabled = true` et
  `workload_type` est laissé `null`, ce qui se résout automatiquement en `StatefulSet` (selon le
  comportement "sélection automatique de StatefulSet" d'App_GKE). Un vrai PVC de bloc est utilisé au lieu de
  gcsfuse spécifiquement parce que les fichiers SQLite de Calibre-Web (`app.db`,
  `metadata.db`) seraient corrompus par le modèle de cohérence relâché de GCS FUSE.
- **La classe de stockage PVC est par défaut SSD (`standard-rwo`).** Cela puise dans le
  quota régional `SSD_TOTAL_GB`, qui est faible sur les projets à quota limité.
  Calibre-Web n'a pas besoin d'IOPS SSD pour sa charge de travail SQLite — envisagez de remplacer
  `stateful_pvc_storage_class = "standard"` (HDD `pd-standard`) pour préserver le quota SSD
  pour d'autres applications tout en conservant l'intégrité du verrouillage en écriture du périphérique de bloc
  dont SQLite a besoin.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  Parce que le StatefulSet utilise `volumeClaimTemplates`, chaque réplica obtient son **propre,
  PVC indépendant** — la mise à l'échelle au-delà de 1 ne partage pas `/config` entre les pods ; elle
  duplique silencieusement la bibliothèque et la configuration en copies séparées et non synchronisées par
  pod. N'augmentez pas `max_instance_count` sans une stratégie de synchronisation externe.
- **Pas de base de données.** `database_type = "NONE"` ; il n'y a pas de job `db-init` et aucune des
  variables liées à la base de données dans ce module n'est référencée.
- **Pas de Redis.** `enable_redis` est déclaré pour la mise en miroir des variables de fondation mais n'est
  **pas transmis** — `main.tf` code en dur `enable_redis = false` à l'appel de la fondation
  quelle que soit la valeur de la variable.
- **`service_type` est par défaut `ClusterIP`, pas `LoadBalancer`.** Combiné avec le
  par défaut `application_domains = []`, le déploiement n'a **pas d'accès externe
  configuré par défaut** même si `enable_custom_domain = true` par défaut
  — la passerelle est provisionnée mais n'a pas de nom d'hôte à router tant que vous ne fournissez pas
  `application_domains` ou ne changez pas `service_type` en `LoadBalancer`.
- **Le mot de passe administrateur généré n'est pas le login fonctionnel.** L'image LinuxServer en amont
  fournit un login par défaut intégré (`admin` / `admin123`) ; le
  secret Secret Manager `CALIBRE_ADMIN_PASSWORD` est provisionné pour un credential plus fort
  mais n'est pas automatiquement câblé dans le conteneur. Changez le
  mot de passe dans l'interface utilisateur de Calibre-Web lors de la première connexion.
- **Un bucket Cloud Storage est créé mais inutilisé par défaut.** `create_cloud_storage
  = true` provisionne toujours le bucket suffixé `storage`, mais il n'est monté
  à `/config` que lorsque `stateful_pvc_enabled = false` (mode déploiement). Avec le
  chemin StatefulSet/PVC par défaut, le bucket existe mais n'est pas attaché à la
  charge de travail.
- **La version de l'image est épinglée via un ARG de build spécifique à l'application.** Le Dockerfile lit
  `CALIBREWEB_VERSION` (pas le générique `APP_VERSION` que la fondation injecte) ; lorsque
  `application_version = "latest"` le build est épinglé à un `0.6.24` connu et fonctionnel.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Calibre-Web {#a-gke-autopilot--the-calibre-web-statefulset}

Les pods Calibre-Web sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. La charge de travail s'exécute en tant que `StatefulSet` (pas un `Deployment`) afin d'obtenir une identité de pod stable et une séquence de redémarrage ordonnée (`stateful_pod_management_policy` par défaut à `OrderedReady` lorsqu'il est laissé `null`).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Calibre-Web pour
  les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et de la sélection du type de charge de travail.

### B. Stockage en mode bloc — la revendication de volume persistant `/config` {#b-block-storage--the-config-persistent-volume-claim}

Les fichiers SQLite de Calibre-Web (`app.db`, `metadata.db` de Calibre), la configuration,
le cache et les journaux résident sur un PVC de bloc par pod monté à `/config`
(`stateful_pvc_mount_path`), d'une taille de `20Gi` par défaut
(`stateful_pvc_size`) sur la StorageClass `standard-rwo` (SSD `pd-balanced`)
(`stateful_pvc_storage_class`).

- **Console :** Kubernetes Engine → Stockage → Revendications de volume persistant ; Compute
  Engine → Stockage → Disques.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Étant donné que les PVC SSD utilisent le quota strict `SSD_TOTAL_GB` et que la mise à l'échelle d'une application stateful à zéro **conserve** son PVC (seule la suppression du PVC/de l'espace de noms récupère le quota), vérifiez l'utilisation actuelle avant une vaste campagne d'applications GKE stateful. Voir [App_GKE](App_GKE.md) pour le cycle de vie général des StatefulSet et des PVC.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** (suffixe `storage`) est toujours provisionné lorsque
`create_cloud_storage = true` (par défaut) et que le compte de service de la charge de travail est
autorisé à y accéder — mais il n'est **monté** dans le pod à `/config` via GCS FUSE
que lorsque `stateful_pvc_enabled = false` (c'est-à-dire lorsqu'il s'exécute en tant que `Deployment` au lieu
du `StatefulSet` par défaut). Avec la configuration par défaut, le bucket existe mais n'est
pas attaché à la charge de travail en cours d'exécution.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Voir [App_GKE](App_GKE.md) pour les montages GCS FUSE et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret Calibre-Web est généré automatiquement et stocké dans Secret Manager :
`CALIBRE_ADMIN_PASSWORD` (une valeur aléatoire de 24 caractères, `secret-<prefix>-<app>-admin-password`),
injecté dans le conteneur en tant que variable d'environnement secrète. Sur GKE, les secrets sont
projetés via le pilote CSI Secret Store / SecretSync ; la clé n'a pas de `__`, c'est donc
un `targetKey` valide.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Remarque : le secret injecté n'est pas automatiquement appliqué comme identifiant de connexion Calibre-Web —
voir §3 pour les identifiants réels de la première connexion. Voir [App_GKE](App_GKE.md) pour
l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

`service_type` est par défaut **`ClusterIP`** (interne uniquement), et
`enable_custom_domain = true` provisionne par défaut une ressource d'API Kubernetes Gateway —
mais avec le `application_domains = []` vide par défaut, il n'y a pas de nom d'hôte
pour que la Gateway puisse router, donc le déploiement n'a **pas d'accès externe
configuré par défaut**. Pour exposer Calibre-Web en externe, définissez
`application_domains` sur un nom d'hôte réel, ou basculez `service_type` sur
`LoadBalancer` (ce qui récupère en plus le nom d'hôte `<reserved-ip>.nip.io` par défaut d'App_GKE
lorsque `reserve_static_ip = true`).

- **Console :** Services réseau → Équilibrage de charge / Passerelles ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Les tests de disponibilité sont désactivés par défaut (`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Calibre-Web {#3-calibre-web-application-behaviour}

- **Pas de job d'initialisation par défaut.** `initialization_jobs` est par défaut `[]` ;
  Calibre-Web gère son propre stockage SQLite et n'a pas besoin de bootstrap de base de données
  (il n'y a pas de job `db-init` car `database_type = "NONE"`). Seuls les jobs fournis par l'utilisateur s'exécutent.
- **Image de wrapper léger, pas de point d'entrée personnalisé.** Le Dockerfile est
  `FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}` sans script de point d'entrée ajouté — l'init basé sur s6 de LinuxServer en amont s'exécute sans modification.
  `image_source = "custom"` est défini uniquement pour que la fondation construise/mette en miroir l'image dans Artifact Registry.
- **Disposition du stockage au premier démarrage.** L'image LinuxServer réduit les privilèges à
  `PUID=1000`/`PGID=1000` et conserve tout l'état sous `/config`
  (`app.db`, `metadata.db` de Calibre, config, cache, journaux) ; la bibliothèque de livres électroniques
  elle-même réside sous `/books` (vide au premier démarrage — l'assistant de configuration intégré à l'application y pointe
  Calibre-Web). `stateful_fs_group` est par défaut `3000` (la convention du graphique Helm CalibreWeb) afin que le PVC soit inscriptible par le groupe.
- **Identifiants de connexion.** Les identifiants de première connexion intégrés à l'image en amont sont
  `admin` / `admin123`. Le secret `CALIBRE_ADMIN_PASSWORD` généré par Secret Manager n'est
  **pas** appliqué automatiquement — il existe pour qu'un mot de passe fort soit disponible dans
  Secret Manager et pour qu'une future image/point d'entrée puisse le consommer. Changez le mot de passe
  administrateur dans l'interface utilisateur de Calibre-Web immédiatement après la première connexion.
- **Sondes de santé.** Les sondes de démarrage et de vivacité émettent toutes deux un **HTTP GET `/`**
  (la page de connexion de Calibre-Web), qui renvoie `200` sans authentification requise —
  les sondes passent donc dès que le serveur est en service, indépendamment de tout état de connexion.
  Démarrage : `initial_delay=15s`, `timeout=5s`, `period=10s`, `failure_threshold=10`.
  Vivacité : `initial_delay=30s`, `timeout=5s`, `period=30s`, `failure_threshold=3`.
- **Contrainte de mise à l'échelle.** `min_instance_count = 1` / `max_instance_count = 1` par
  défaut. Étant donné que le StatefulSet provisionne un PVC distinct par réplica
  (`volumeClaimTemplates`), l'augmentation de `max_instance_count` ne donne **pas** aux pods une
  bibliothèque partagée — chaque pod obtient sa propre `/config` indépendante et non synchronisée.
- **Vérifier le déploiement :**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /config
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Calibre-Web sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calibreweb` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag `lscr.io/linuxserver/calibre-web` utilisé comme base de build personnalisé ; `latest` est épinglé à un tag connu et fonctionnel (`0.6.24`) au moment du build via l'ARG de build `CALIBREWEB_VERSION` spécifique à l'application. |
| `application_display_name` | `Calibre-Web` | Nom lisible par l'homme à des fins d'affichage. |
| `description` | `Calibre-Web — a web app for browsing, reading and downloading ebooks from a Calibre library.` | Rempli la description de la charge de travail GKE. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Limite de mémoire pour le conteneur Calibre-Web. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Maintenir à 1 — voir la contrainte de mise à l'échelle §3 (duplication de PVC par réplica). |
| `container_port` | `8083` | Fixé par `CalibreWeb_Common` ; la variable du module n'est pas transmise à App_GKE et n'a aucun effet. |
| `enable_cloudsql_volume` | `false` | Correctement désactivé — Calibre-Web n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessible en externe par défaut. Définissez `ClusterIP` pour un accès interne uniquement — voir §2.E pour le piège d'ingress que cela crée en combinaison avec `application_domains = []`. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant par défaut (un seul réplica rend cela sans objet à l'échelle par défaut). |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un PVC de bloc par pod — requis car gcsfuse corromprait les fichiers SQLite de Calibre-Web. |
| `stateful_pvc_size` | `20Gi` | Taille pour `/config` plus la bibliothèque Calibre. |
| `stateful_pvc_mount_path` | `/config` | Où Calibre-Web stocke ses bases de données SQLite, sa configuration, son cache et ses journaux. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Utilise le quota régional `SSD_TOTAL_GB`. La charge de travail SQLite de Calibre-Web n'a pas besoin d'IOPS SSD — envisagez `standard` (HDD `pd-standard`) pour conserver le quota SSD. |
| `stateful_fs_group` | `3000` | Correspond à la convention du graphique Helm CalibreWeb afin que le PVC soit inscriptible par le groupe par `PUID:PGID=1000:1000`. |

### Groupe 9 — PodDisruptionBudget {#group-9--poddisruptionbudget}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut (contrairement à la plupart des modules). |
| `pdb_min_available` | `1` | Avec `max_instance_count = 1`, un PDB de `1` bloque effectivement l'éviction volontaire du seul pod jusqu'à ce qu'il puisse être replanifié. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` (de `CalibreWeb_Common`) | HTTP `/` | Page de connexion, `200`, aucune authentification requise — passe dès que le serveur est en service. |
| `uptime_check_config.enabled` | `false` | Les tests de disponibilité sont désactivés par défaut. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est **pas** utilisé par Calibre-Web — la persistance se fait via le PVC du StatefulSet (ou GCS FUSE en mode déploiement) à la place. |
| `network_tags` | `["nfsserver"]` | Par défaut, inclut le tag `nfsserver` même si NFS est désactivé par défaut ; inoffensif mais pertinent uniquement si vous activez NFS séparément. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne toujours le bucket suffixé `storage`, mais voir §2.C — il est démonté tant que `stateful_pvc_enabled = true` (par défaut). |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (déclaré) | **Inerte** — `main.tf` code en dur `enable_redis = false` sur l'appel de la fondation quelle que soit la valeur de cette variable. Calibre-Web n'utilise pas Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Déclaré pour la mise en miroir des variables de fondation mais **non transmis** à App_GKE du tout. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `CalibreWeb_Common` ; aucune instance Cloud SQL, base de données ou utilisateur n'est créé. Toutes les autres variables `database_*`/`sql_*` de ce groupe sont explicitement "Non référencées". |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la ressource d'API Gateway, mais ne fait rien d'utile en externe sans que `application_domains` soit défini (voir §2.E). |
| `application_domains` | `[]` | Vide par défaut — définissez-le pour obtenir un nom d'hôte externe fonctionnel tant que `service_type = ClusterIP`. |
| `reserve_static_ip` | `true` | Se lie au nom d'hôte `<reserved-ip>.nip.io` par défaut d'App_GKE uniquement lorsque `service_type = LoadBalancer` ; le comportement combiné avec le `ClusterIP` par défaut n'est pas explicitement documenté par la fondation. {/* TODO: confirm whether reserve_static_ip provisions/attaches an address when service_type stays ClusterIP with enable_custom_domain=true */} |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée et `service_type = LoadBalancer`). |
| `service_url` | URL pour atteindre Calibre-Web. |
| `calibreweb_admin_password_secret_id` | ID du secret Secret Manager contenant le `CALIBRE_ADMIN_PASSWORD` généré (voir §3 pour savoir pourquoi ce n'est pas le login initial). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Chaque réplica StatefulSet obtient son propre PVC (`volumeClaimTemplates`) — la mise à l'échelle duplique `/config` en copies indépendantes et non synchronisées par pod, et non une bibliothèque partagée. |
| `stateful_pvc_enabled` | `true` (conserver) | Critique | Le passage en mode `false`/`Deployment` déplace `/config` sur GCS FUSE, ce qui peut corrompre les fichiers SQLite de Calibre-Web (`app.db`, `metadata.db`) selon ses modèles d'accès. |
| `service_type` + `application_domains` | Définir `application_domains`, ou utiliser `LoadBalancer` | Élevé | Avec les valeurs par défaut (`ClusterIP` + `application_domains` vide), le déploiement n'a **aucun accès externe configuré** malgré `enable_custom_domain = true`. |
| `stateful_pvc_storage_class` | `standard` (HDD) pour les projets à quota limité | Moyen | Le `standard-rwo` par défaut (SSD) utilise le quota strict `SSD_TOTAL_GB` ; une campagne d'applications GKE stateful peut l'épuiser vers l'application n°8. La mise à l'échelle à zéro ne libère **pas** le PVC — seule sa suppression le fait. |
| `CALIBRE_ADMIN_PASSWORD` (auto-généré) | Changer le login dans l'interface utilisateur lors de la première connexion | Élevé | Le secret généré n'est pas appliqué automatiquement ; l'identifiant de première connexion fonctionnel est le `admin`/`admin123` par défaut en amont jusqu'à ce qu'il soit modifié manuellement. |
| `enable_resource_quota` | Comprendre avant d'activer | Moyen | Les variables `quota_cpu_*`/`quota_memory_*`/`quota_max_*` de ce module sont déclarées mais **non transmises** à App_GKE — l'activation du quota utilise les propres valeurs par défaut de la fondation (4 CPU / 4-8 Gio de mémoire / 20 pods), et non une valeur définie sur ce module. |
| `enable_redis` | Ignorer — inerte | Faible | `main.tf` code en dur `enable_redis = false` quelle que soit cette variable ; Calibre-Web n'a pas de dépendance Redis. |
| `create_cloud_storage` | `false` si vous n'avez pas besoin du bucket de secours | Faible | Avec le chemin StatefulSet par défaut, le bucket `storage` est provisionné mais jamais monté — un coût faible et évitable si vous ne prévoyez pas de passer en mode déploiement. |
| `memory_limit` | `1Gi` (augmenter pour les grandes bibliothèques) | Moyen | Calibre-Web charge les index de bibliothèque/collection en mémoire ; un sous-dimensionnement risque un OOM avec une grande bibliothèque Calibre. |
| `quota_memory_requests` / `_limits` (au niveau de la fondation, si activation directe des quotas sur App_GKE) | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Calibre-Web partagée entre les variantes de plateforme est
décrite dans **[CalibreWeb_Common](CalibreWeb_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Calibre-Web sur GKE Autopilot](../labs/CalibreWeb_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Calibre-Web sur Google Cloud Run](CalibreWeb_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Calibre-Web Common — Configuration d'application partagée](CalibreWeb_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Komga sur GKE Autopilot](Komga_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md), [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Bibliothèque numérique**.
