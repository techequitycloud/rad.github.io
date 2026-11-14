---
title: "Chibisafe sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Chibisafe sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chibisafe_GKE.md @ 40c83c3f sha256:b17122258060 -->

# Chibisafe sur GKE Autopilot {#chibisafe-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chibisafe_GKE.png" alt="Chibisafe sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chibisafe est un outil d'upload de fichiers et d'images auto-hébergé avec un
tableau de bord moderne, des uploads par glisser-déposer, des albums et une API
publique. Ce module déploie la **pile Chibisafe complète** — l'interface web à
`/`, l'API REST sous `/api`, la référence OpenAPI à `/docs`, et les
fichiers uploadés servis par leur nom — comme une seule charge de travail sur
**GKE Autopilot**, au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.
L'amont livre Chibisafe sous forme de trois conteneurs (le backend chibisafe-server,
un frontend Next.js et un proxy inverse Caddy) ; ce module les combine en une
seule image personnalisée.

> **Statut :** l'image full-stack n'a pas encore été construite ou déployée,
> donc le comportement ci-dessous est décrit à partir de la source du module et
> de la version `v6.5.5` de l'amont, non vérifié en direct.

Ce guide se concentre sur les services cloud utilisés par Chibisafe et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Chibisafe sur RAD, et comparaison {#what-chibisafe-costs-on-rad-and-how-that-compares}

**Le module Chibisafe sur GKE Autopilot de RAD coûte environ 42 $ US par mois
dans votre propre projet Google Cloud, sans frais de licence
supplémentaires** — Chibisafe est open source. Dans un projet géré par RAD pour
vous, le même déploiement est facturé à **75 crédits par jour** (environ 2 250
par mois, soit environ 225 $ US au prix de la recharge). Ou consultez le [guide
Cloud Run](Chibisafe_CloudRun.md) pour l'option moins chère. Si vous n'avez
besoin de Chibisafe qu'occasionnellement — pour des études, une démo, un projet
de courte durée — un projet géré par RAD peut être supprimé et restauré dans
les 30 jours sans frais supplémentaires, de sorte que ce chiffre mensuel devient
quelques dollars. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Chibisafe est open source, il n'y a donc pas de frais de licence. Vous payez
pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **75 crédits par jour**, environ 2 250 par mois (environ 225 $ US au prix de la recharge ; estimé à partir des prix catalogue de Google, et incluant les frais de cluster) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

**Pourquoi les deux colonnes diffèrent.** Le chiffre géré par RAD inclut les
frais de gestion du cluster GKE (environ 73 $ US par mois) et la fondation
partagée du projet. Dans votre propre projet, le niveau gratuit de Google couvre
les frais de gestion d'un cluster par compte de facturation, ce que le chiffre
du propre projet suppose. Il est estimé à partir des prix catalogue de Google,
car il n'y a pas encore assez d'historique GKE géré par RAD pour le mesurer,
donc la confirmation de déploiement ne le cite pas. Une deuxième application GKE
dans le même projet géré par RAD partage le cluster et n'ajoute que ses propres
pods.

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que
soit le montant : une fois par compte, pour un module que vous déployez et payez
vous-même (dans une solution, les frais d'une application : la première à
réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, donc une
deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 Gio | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion du cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total (hors frais de cluster GKE partagé)** | **environ 42 $ US** |

Ces prix sont les mêmes en africa-south1 (Johannesburg).

- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod est toujours en
  cours d'exécution, donc le coût ci-dessus s'applique que quelqu'un utilise ou
  non l'application ; des pods supplémentaires ne sont ajoutés que sous charge.

### Comparaison pour un hébergement de fichiers personnel ou pour petite équipe {#how-it-compares-for-a-personal-or-small-team-file-host}

Chibisafe n'a pas d'offre hébergée officielle — il est livré comme une pile
auto-hébergée, donc la comparaison réaliste est un serveur nu :

- Un Hetzner CPX22 ou un droplet DigitalOcean (2 vCPU/4 Go, environ 24 $/mois)
  ou un GCP e2-standard-2 (2 vCPU/8 Go, environ 49 $/mois) le ferait
  fonctionner confortablement — surdimensionné pour l'empreinte de 1 vCPU/1 Gio
  de Chibisafe ici, donc une classe d'instance plus petite et moins chère
  ferait tout aussi bien l'affaire.
- Sur un VPS nu, vous possédez le système d'exploitation, les correctifs de
  sécurité et votre propre discipline de sauvegarde. Le module de RAD vous
  fournit le calcul, Secret Manager et Cloud Monitoring déjà câblés, pour les
  frais de module plus l'utilisation de Google Cloud ci-dessus.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Chibisafe s'exécute dans **un projet géré par RAD pour vous**, la
suppression de l'ensemble du projet — plutôt que la suppression de ce seul
module — délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement. Google le conserve, récupérable, pendant 30
jours, et comme la facturation est déjà déliée, rien n'est facturé pendant
l'attente. Contrairement à la suppression d'un module, cela ne supprime pas
Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.**
> Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou
> les ressources qu'il contient, seront utilisables après sa restauration, de
> sorte que la restauration ne peut pas être invoquée comme un moyen de
> récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué
> des sauvegardes appropriées des données et de la configuration de
> l'application et de les avoir stockées en dehors du projet. Si une
> restauration échoue, ou si le projet restauré ne fonctionne pas, la solution
> de repli consiste à redéployer l'application (voir la section suivante) et à
> restaurer sa configuration et ses données à partir de ces sauvegardes.

- **La restauration est une vérification, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut demander à Google de récupérer le projet
  et de rattacher son compte de facturation, puis d'exécuter **Update** sur
  chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes, et une mise à jour ne facture jamais les frais de module à nouveau.
  Les mises à jour sont incluses dans le prix (5 par mois pour chaque
  déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ce qu'il faut.** Vous devez posséder le projet (pas un projet dont RAD gère
  uniquement la facturation), le restaurer vous-même dans les 30 jours — après
  quoi Google le supprime définitivement — et effacer à nouveau le seuil
  d'admission du niveau (100 crédits pour le niveau sandbox qui convient à la
  plupart des utilisations d'étude/démo). Google indique que la plupart des
  services sont de nouveau pleinement fonctionnels dans les 36 heures suivant
  une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket
  a la suppression logicielle de Cloud Storage désactivée, il est donc très
  probable qu'il disparaisse dès que le projet est supprimé — même si le projet
  lui-même est récupérable pendant 30 jours. Copiez une sauvegarde (vers Google
  Drive, ou un bucket en dehors du projet) avant de supprimer s'il y a quelque
  chose à conserver ; pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

Source : [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de restauration de 30 jours
ci-dessus est passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds
  sont inclus) : 75 crédits (7,50 $ US) au prix de la recharge. La suppression
  ne permet d'économiser de l'argent que si Chibisafe devait rester inutilisé
  pendant environ **3 jours ou plus** — dans votre propre projet, cela
  représente environ 1,40 $ US par jour, et dans un projet géré par RAD, c'est
  75 crédits par jour.
- La majeure partie du coût d'exécution ici est généralement la base de données
  et/ou la VM ou le cluster de fichiers/cache partagé. Ils ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de
  Chibisafe alors qu'une autre application partage le projet n'économise que la
  partie calcul de Chibisafe.
- **Conservez les données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez
  la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et la mise en garde sur le bucket de
sauvegarde ; les prix changent, vérifiez chaque source avant de vous fier à un
chiffre.

## 1. Vue d'ensemble {#1-overview}

Chibisafe s'exécute comme une seule charge de travail — un conteneur avec Caddy
devant deux processus Node.js (backend et frontend) — sans base de données
externe. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod full-stack (Caddy sur le port 8000 → backend + frontend Next.js sur loopback), StatefulSet par défaut, 1 vCPU / 1 Gio par défaut |
| Base de données | Aucune | Chibisafe conserve sa base de données SQLite, ses uploads et ses logs sur le volume persistant — aucune instance Cloud SQL n'est créée |
| Stockage par blocs | GKE StatefulSet PVC | PVC `standard-rwo` de 20 Gio par défaut monté à `/data`, contenant la base de données SQLite, les uploads et les logs |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est toujours provisionné ; monté uniquement comme volume GCS FUSE lorsque le PVC StatefulSet est désactivé |
| Secrets | Secret Manager | Optionnel `ADMIN_PASSWORD` (géré par `enable_api_key`, désactivé par défaut) |
| Ingress | Kubernetes Gateway / Cloud Load Balancing | Domaine personnalisé + certificat géré activé **par défaut** (`enable_custom_domain = true`) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule « base de données »**. `database_type` est fixé à `NONE` par
  `Chibisafe_Common` ; les nombreuses variables `database_*`/`db_*` reflétées dans
  `variables.tf` existent uniquement pour la parité de convention de la Fondation et
  n'ont aucun effet.
- **StatefulSet + PVC de bloc est la valeur par défaut.** SQLite ne tolère pas
  la sémantique de verrouillage de fichiers POSIX de GCS FUSE, donc `stateful_pvc_enabled = true` par
  défaut, ce qui résout automatiquement `workload_type` en `StatefulSet` avec un PVC
  `standard-rwo` de 20 Gio à `/data`.
- **Écriture unique, réplica unique.** `min_instance_count = 1`, `max_instance_count
  = 1` — Chibisafe est une
  application SQLite à écriture unique ; ne pas dépasser 1 sans repenser le
  stockage.
- **Image personnalisée avec une version spécifique à l'application.** `image_source = "custom"`
  construit un Dockerfile basé sur `chibisafe/chibisafe-server` (backend à `/app`) qui copie
  le frontend Next.js `chibisafe/chibisafe` (`/opt/chibisafe-web`) et un binaire Caddy statique
  `2.11.4`. La construction lit son propre argument de construction `CHIBISAFE_VERSION`
  (pas le générique `APP_VERSION` que la Fondation injecte ; une balise épingle le
  backend et le frontend) ; `application_version = "latest"` est épinglé à `v6.5.5` au moment de la
  construction.
- **Pas de Redis, jamais.** La variante reflète une variable `enable_redis` pour la
  parité de convention de la Fondation, mais `main.tf` transmet toujours
  `enable_redis = false` à App_GKE quelle que soit sa valeur — Chibisafe n'a pas de
  dépendance Redis.
- **Le domaine personnalisé est activé par défaut.** Contrairement à la plupart
  des modules, `enable_custom_domain =
  true` est prêt à l'emploi ; définissez `application_domains` pour que le
  certificat géré se rattache réellement à un nom d'hôte.
- **Pas de secrets obligatoires.** `enable_api_key = false` par défaut — le backend crée le
  compte propriétaire de première exécution `admin` avec le mot de passe amont
  bien connu `admin` ; changez-le immédiatement après la première connexion dans
  l'interface web. Passez `enable_api_key` à `true` pour pré-remplir un
  `ADMIN_PASSWORD` aléatoire depuis Secret Manager à la place.
- **Tout l'état vit sous un seul montage.** Le point d'entrée lie
  symboliquement les répertoires `/app/database`, `/app/uploads` et `/app/logs` de l'image
  dans des sous-répertoires du volume persistant unique (`/data`), migrant
  tout contenu amorcé par l'image au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Chibisafe {#a-gke-autopilot--the-chibisafe-workload}

Les pods Chibisafe sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Avec la valeur par défaut `stateful_pvc_enabled = true`, la charge
de travail est un **StatefulSet** avec une gestion de pod `OrderedReady` et un PVC
stable par pod — un meilleur ajustement qu'un déploiement pour une application
SQLite à écriture unique.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Chibisafe pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe (le cas
  échéant).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector=app~chibisafe
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Stockage persistant — PVC de bloc et Cloud Storage {#b-persistent-storage--block-pvc-and-cloud-storage}

Chibisafe n'a pas de service de base de données à inspecter — son état (base de
données SQLite, fichiers téléchargés et journaux) réside entièrement sur le
volume persistant monté à `/data`. Par défaut, ce volume est un
**PersistentVolumeClaim de bloc** par pod (`stateful_pvc_enabled = true`, 20 Gio `standard-rwo`), ce
qui donne aux fichiers SQLite les E/S à faible latence et conformes à POSIX
dont ils ont besoin. Un bucket **Cloud Storage** `storage` est toujours
provisionné par `Chibisafe_Common`, mais il n'est monté comme volume GCS FUSE que lorsque
le PVC StatefulSet est désactivé (`enable_gcs_storage_volume` est calculé comme `!stateful_pvc_enabled` dans
`main.tf`) — évitant un double montage au même chemin.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims pour le
  PVC ; Cloud Storage → Buckets pour le bucket `storage` toujours créé.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /data
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  ```

Voir [App_GKE](App_GKE.md) pour le cycle de vie du PVC StatefulSet, les options
StorageClass et les détails du montage GCS FUSE.

### C. Secret Manager {#c-secret-manager}

Chibisafe ne génère **aucun secret par défaut**. Le seul secret optionnel est un
mot de passe administrateur aléatoire, géré par `enable_api_key` (par défaut
`false`) : lorsqu'il est activé, une valeur aléatoire de 24 caractères est
stockée dans Secret Manager (suffixe de nom `api-key`) et livrée au pod comme un
**Secret Kubernetes natif** (via `explicit_secret_values`, pas le chemin habituel Secret Manager
→ SecretSync) injecté comme variable d'environnement `ADMIN_PASSWORD` — le backend de
Chibisafe amorce son compte administrateur de première exécution à partir de
cette valeur au lieu de la valeur par défaut amont bien connue.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le modèle d'injection Secret Store CSI / Secret
natif et la rotation.

### D. Réseau et ingress {#d-networking--ingress}

`enable_custom_domain = true` par défaut, exposant Chibisafe via une passerelle Kubernetes avec un
certificat géré par Google une fois que `application_domains` est renseigné. Le service
interne par défaut est `ClusterIP` ; passez `service_type` à `LoadBalancer` pour une IP
externe directe au lieu (ou en plus) du chemin de la passerelle.

- **Console :** Services réseau → Passerelles, ou Équilibrage de charge (si
  `service_type =
  LoadBalancer`) ; Réseau VPC → Adresses IP pour l'IP statique réservée.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des stratégies d'alerte optionnelles sont disponibles mais
désactivées par défaut (`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

Voir [App_GKE](App_GKE.md) pour les exigences d'accessibilité des tests de
disponibilité et le câblage des alertes.

---

## 3. Comportement de l'application Chibisafe {#3-chibisafe-application-behaviour}

- **Pas de job d'initialisation ou de migration.** Chibisafe gère son propre
  stockage SQLite ; `Chibisafe_Common` n'injecte pas de job `db-init`/de migration par
  défaut. La variable `initialization_jobs` est disponible uniquement pour des tâches de
  chargement de données personnalisées.
- **Relocalisation de l'état au premier démarrage.** L'image conserve l'état
  mutable sous trois répertoires frères dans son WORKDIR — `/app/database` (SQLite),
  `/app/uploads` (fichiers/miniatures) et `/app/logs`. Le point d'entrée (`entrypoint.sh`)
  lie symboliquement chacun d'eux dans un sous-répertoire du montage persistant
  unique (`/data` par défaut), migrant tout contenu amorcé par l'image dans le
  volume vide au premier démarrage. Ceci est idempotent lors des redémarrages —
  les répertoires déjà liés symboliquement sont laissés intacts.
- **Compte administrateur.** Au premier démarrage, le backend crée le compte
  propriétaire `admin`. Si `enable_api_key = true`, une valeur aléatoire est générée et
  injectée comme `ADMIN_PASSWORD`, que le backend utilise comme mot de passe de ce
  compte au lieu de la valeur par défaut amont bien connue (`admin`) ; sinon,
  connectez-vous avec `admin`/`admin` et changez-le immédiatement.
  `ADMIN_PASSWORD` est transmis uniquement au processus backend — le point d'entrée le
  supprime de l'environnement du frontend et de Caddy.
- **Pas d'alias de variable d'environnement de base de données.** `database_type = NONE` — il
  n'y a pas d'injection ou d'alias `DB_HOST`/`DB_USER` à craindre ; SQLite vit
  entièrement sur le volume `/data`.
- **Processus et ports.** `tini` est PID 1 ; le point d'entrée (après la
  relocalisation d'état ci-dessus) démarre trois processus :

  | Processus | Écoute sur | Sert |
  |---|---|---|
  | Caddy | `0.0.0.0:8000` (`container_port`) | Le seul écouteur vers lequel le Service achemine |
  | Backend chibisafe-server | `127.0.0.1:18000` (loopback uniquement) | `/api/*`, `/docs*` |
  | Frontend Next.js | `127.0.0.1:18001` (loopback uniquement) | L'interface web |

  Ils sont supervisés en mode **fail-fast** : si l'un d'eux se termine, les
  autres sont arrêtés et le conteneur se termine avec le statut 1, de sorte que
  Kubernetes le redémarre (choisi plutôt que supervisord, qui maintiendrait un
  conteneur en bonne santé avec un frontend mort).
- **Routage** (Caddyfile `v6.5.5` de l'amont, même ordre) : tout chemin nommant
  un fichier sous `/data/uploads` est servi directement par Caddy (le backend ne sert
  pas les uploads en production) ; `/api/*` → backend (l'API REST — voir la
  sortie `api_url`) ; `/docs*` → backend (la référence OpenAPI Scalar) ; tout
  le reste → frontend (l'interface web à `/`, par exemple `/dashboard`,
  `/login`). Deux déviations par rapport à l'amont : l'en-tête `Host` est
  préservé, de sorte que les liens de fichiers construits par le backend sont
  corrects sans définir « Serve uploads from » ; et `X-Forwarded-For`/`X-Real-IP` sont
  définis sur l'IP client que Caddy résout lui-même (plages de l'équilibreur de
  charge Google fiables, sélection stricte la plus à droite), de sorte qu'un
  client ne peut pas les usurper.
- **Frontend → backend.** Le rendu côté serveur du frontend appelle le backend
  directement à `BASE_API_URL=http://127.0.0.1:18000`, défini par le point d'entrée ; le navigateur appelle
  la même origine `/api`.
- **Environnement du conteneur.** `NODE_ENV=production` est la seule valeur par défaut à
  l'échelle du conteneur ; `HOST`/`HOSTNAME`/`PORT` pour les deux processus
  Node sont définis par processus par le point d'entrée (`HOSTNAME` doit être
  surchargé car Kubernetes le définit sur le nom du pod). `PORT` est
  délibérément laissé non défini par `Chibisafe_Common` ; Caddy revient à `8000`,
  correspondant à `container_port`.
- **Téléchargements.** Un service LoadBalancer n'impose aucune limite de corps
  de requête, de sorte que la taille de bloc de téléchargement par défaut de
  Chibisafe (environ 81 Mo) fonctionne telle quelle — contrairement à
  `Chibisafe_CloudRun`, où la limite de 32 Mio de Cloud Run nécessite de la réduire.
- **Mémoire.** La valeur par défaut `1Gi` contient maintenant deux processus
  Node plus Caddy ; cela n'a pas encore été mesuré en direct — augmentez
  `memory_limit` si le pod est tué par manque de mémoire.
- **Mise à jour d'un déploiement existant.** Une MISE À JOUR d'un déploiement
  effectué avec la version précédente uniquement backend reconstruit
  automatiquement l'image (le hachage de contenu du répertoire scripts change),
  conserve le port `8000`, supprime la variable d'environnement `HOST=0.0.0.0` à
  l'échelle du conteneur (maintenant définie par processus) et laisse les
  données sur le PVC `/data` intactes. `/` passe d'une réponse JSON 404 à
  l'interface web.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux
  **HTTP** `GET /api/health` (`startup_probe`/`liveness_probe` par défaut `path = "/api/health"`,
  correspondant à `Chibisafe_CloudRun`), envoyées via Caddy au backend, qui renvoie un
  littéral `200 {"status":"yes"}` une fois le service démarré, aucune authentification requise
  — c'est aussi ce dont le contrôle de santé de la passerelle (reflétant la
  sonde de vivacité) a besoin : exactement 200. `/` est l'interface web,
  dont le code de statut est le choix du frontend plutôt qu'un signal de santé.
  Les variables alternatives `health_check_config`/`startup_probe_config` ont maintenant aussi par défaut
  `path = "/api/health"` mais sont remplacées — la fondation prend les sondes de
  `startup_probe`/`liveness_probe`.
- **Contrainte de mise à l'échelle à écriture unique.** `min_instance_count = max_instance_count =
  1` par défaut ;
  chaque pod StatefulSet possède son propre PVC, donc la mise à l'échelle au-delà
  de 1 sans repenser le stockage risque des écritures SQLite fractionnées.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /app/database /app/uploads /app/logs
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'HOST|NODE_ENV|PORT'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Chibisafe sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chibisafe` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise d'image `chibisafe/chibisafe-server` ; `latest` est épinglé à `v6.5.5` au moment de la construction via l'argument de construction `CHIBISAFE_VERSION` spécifique à l'application. |
| `enable_api_key` | `false` | Génère une valeur aléatoire dans Secret Manager, injectée comme `ADMIN_PASSWORD` via un Secret Kubernetes natif, amorçant le premier identifiant administrateur au lieu de la valeur par défaut amont. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | 1 Gio par défaut, partagé par deux processus Node et Caddy ; pas encore mesuré en direct. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Maintenir à 1 — Chibisafe est une application SQLite à écriture unique. |
| `container_port` | `8000` | Le port du proxy Caddy. Fixé par `Chibisafe_Common` ; cette variable n'est pas transmise à App_GKE et sa modification n'a aucun effet. |
| `enable_cloudsql_volume` | `false` | Chibisafe n'a pas de base de données Cloud SQL — laisser `false`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interne par défaut ; le chemin de la passerelle (Groupe 19) est la route par défaut vers le trafic externe. |
| `workload_type` | `null` → `StatefulSet` | Résolution automatique car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | Aucune persistance client configurée par défaut. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Requis — SQLite ne tolère pas le verrouillage de fichiers POSIX de GCS FUSE. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Dimensionnez le PVC pour contenir la base de données SQLite plus tous les fichiers téléchargés. |
| `stateful_pvc_mount_path` | `/data` | Le point d'entrée lie symboliquement `/app/database`, `/app/uploads` et `/app/logs` dans ce montage. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré basé sur SSD ; utilise le quota `SSD_TOTAL_GB` — remplacer par `standard` (HDD) sur les projets à quota limité. |
| `stateful_fs_group` | `3000` | Correspond à la convention UID 1000 / GID 2000 du graphique Helm de Chibisafe afin que le PVC soit accessible en écriture par le groupe. |

### Groupe 10 — Observabilité {#group-10--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | `path = "/api/health"` | Les sondes actives et effectives (transmises à `App_GKE` dans `main.tf`). Envoyées via le proxy Caddy au backend — un littéral `200 {"status":"yes"}`, aucune authentification requise. |
| `health_check_config` / `startup_probe_config` | `path = "/api/health"` | Inertes — déclarées uniquement pour la mise en miroir des variables de la fondation, jamais transmises à `App_GKE`. Ne vous fiez pas à celles-ci pour modifier la sonde déployée. |
| `uptime_check_config` | `enabled = false`, `path = "/api/health"` | Activer pour ajouter un test de disponibilité public et une alerte une fois que le point de terminaison est publiquement accessible. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` toujours présent (suffixe `storage`). |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Le bucket de stockage Chibisafe est automatiquement monté à `/data` uniquement lorsque `stateful_pvc_enabled = false` ; avec la valeur par défaut StatefulSet, il est créé mais laissé non monté pour éviter un double montage à `/data`. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (mis en miroir, **inerte**) | Déclaré uniquement pour la parité de convention de la Fondation — `Chibisafe_GKE/main.tf` transmet toujours `enable_redis = false` à App_GKE quelle que soit cette valeur. Chibisafe n'a pas de dépendance Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (inhabituel parmi les modules) — Kubernetes Gateway + certificat géré. |
| `application_domains` | `[]` | Doit être renseigné pour que le certificat géré se rattache à un nom d'hôte réel. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée). |
| `service_url` | URL de l'interface web de Chibisafe (servie à `/`). La même adresse sert l'API REST sous `/api`, la référence OpenAPI à `/docs` et les fichiers téléchargés par leur nom. Externe avec une IP d'équilibreur de charge réservée, sinon l'URL intra-cluster. |
| `api_url` | URL de base de l'API REST (`<service_url>/api`), pour les clients de téléchargement et les scripts ; `GET <api_url>/health` renvoie `200 {"status":"yes"}`. |
| `chibisafe_api_key_secret_id` | ID du secret Secret Manager pour le secret optionnel du mot de passe administrateur. Vide lorsque `enable_api_key = false`. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — en associant `workload_type = "Deployment"` à `stateful_pvc_enabled = true`, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver entraîne un retour à un montage GCS FUSE à `/data`, dont le comportement de verrouillage de fichiers POSIX est dangereux pour SQLite et risque de corrompre la base de données. |
| `stateful_pvc_mount_path` | `/data` | Critique | Les liens symboliques de relocalisation du point d'entrée (`/app/database`, `/app/uploads`, `/app/logs`) sont codés en dur pour ce montage ; le modifier sans mettre à jour l'image rompt la persistance de l'état. |
| `workload_type` | `null` (→ `StatefulSet`) | Critique | Forcer `Deployment` en même temps que `stateful_pvc_enabled = true` échoue au moment de la planification ; le forcer via `stateful_pvc_enabled = false` échange l'intégrité de SQLite contre le risque GCS FUSE (voir ci-dessus). |
| `max_instance_count` | `1` | Élevé | Chibisafe est une application SQLite à écrivain unique ; la mise à l'échelle au-delà d'un pod risque des écrivains partagés et un état corrompu même si chaque réplica StatefulSet obtient son propre PVC. |
| `stateful_fs_group` | `3000` | Élevé | Un `fsGroup` non concordant ou non défini laisse le montage PVC sans accès en écriture de groupe pour l'UID du conteneur, ce qui entraîne des échecs d'écriture pour la base de données SQLite et les téléchargements. |
| `stateful_pvc_storage_class` | `standard-rwo` (remplacer par `standard` si contraint) | Moyen | Le `standard-rwo` basé sur SSD attire le quota strict `SSD_TOTAL_GB` ; une campagne d'applications avec état peut l'épuiser. La mise à l'échelle à zéro ne libère **pas** le PVC — seule la suppression le fait. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms (uniquement pertinent si `enable_resource_quota = true`). |
| `enable_custom_domain` | `true` avec `application_domains` défini | Moyen | Si elle est laissée activée avec un `application_domains` vide, le chemin Gateway/certificat géré n'a pas de nom d'hôte auquel se rattacher. |
| `enable_redis` | toute valeur (inerte) | Faible | `main.tf` transmet toujours `enable_redis = false` — la modification de cette variable n'a aucun effet ; ne vous y fiez pas pour ajouter la connectivité Redis. |
| `container_port` | `8000` (fixe) | Faible | La variable est déclarée pour la parité de convention mais n'est pas transmise à App_GKE ; la modifier ne change pas le port d'écoute réel du proxy Caddy. |
| `database_type` / `db_*` variables | `NONE` / inerte | Faible | Chibisafe n'a pas de base de données SQL ; celles-ci n'existent que pour la mise en miroir des variables de la Fondation et sont ignorées silencieusement. |
| `enable_api_key` | `true` si le service est accessible de l'extérieur ; sinon, changez le mot de passe par défaut à la première connexion | Moyen | S'il est désactivé, le compte `admin` démarre avec le mot de passe amont bien connu `admin` — changez-le à la première connexion, surtout si le service est accessible de l'extérieur. Les clés API par requête sont générées à l'intérieur de l'application. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Chibisafe partagée avec la variante Cloud Run est
décrite dans le module Chibisafe_Common (`modules/Chibisafe_Common/README.md`).

## Guides associés {#related-guides}

- [Lab pratique : Chibisafe sur GKE Autopilot](../labs/Chibisafe_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Chibisafe Common — Configuration d'application partagée](Chibisafe_Common.md) — la configuration partagée par les deux cibles de déploiement.
