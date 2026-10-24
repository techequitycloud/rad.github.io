---
title: "Navidrome sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Navidrome sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Navidrome_GKE.md @ 1665a43e sha256:4a8e12081e6c -->

# Navidrome sur GKE Autopilot {#navidrome-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Navidrome_GKE.png" alt="Navidrome sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Navidrome est un serveur de streaming musical auto-hébergé, gratuit et open source, écrit en Go.
Il expose une API compatible Subsonic/OpenSubsonic (ainsi, tout client Subsonic — DSub,
Symfonium, Sublime Music, play:Sub, etc. — peut parcourir et streamer votre bibliothèque) ainsi que
sa propre interface web, et stocke son état dans une base de données **SQLite** embarquée plutôt que
dans un backend SQL géré. Ce module déploie Navidrome sur **GKE Autopilot** en s'appuyant sur
la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Navidrome et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Navidrome sur RAD, et comment cela se compare {#what-navidrome-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Navidrome sur RAD coûte environ 42 à 115 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** GKE Autopilot convient à Navidrome qui doit rester opérationnel, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, le [module Cloud Run](Navidrome_CloudRun.md) exécute le même Navidrome pour environ 33 $ US par mois. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Navidrome**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour
trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (8 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 $ US par mois** pour la configuration par défaut (tableau ci-dessous) — plus si ce n'est pas votre seul cluster Autopilot | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 $ US au prix de la recharge, 161 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 42 $ US** (environ 115 $ US si ce n'est pas votre seul cluster Autopilot) |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour Navidrome lui-même**, la comparaison honnête est donc un serveur auto-géré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Il s'agit d'une charge de travail légère — une classe de VPS moins chère et plus petite que les boîtiers de référence ci-dessous ferait également l'affaire ; les chiffres sont présentés pour une comparaison équivalente.
- Il s'agit d'un serveur de musique personnel, pas d'un produit d'équipe avec un concurrent SaaS sous licence — la comparaison qui compte est l'auto-hébergement par rapport à la gestion du projet par RAD, et non RAD par rapport à un abonnement de streaming (un service de streaming n'héberge pas *votre propre* bibliothèque).
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui corrigez le système d'exploitation, faites tourner les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Cloud SQL, Secret Manager et la surveillance gérés par RAD s'en occupent pour vous, ce qui est le véritable argument en faveur de RAD par rapport à un boîtier moins cher — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Navidrome fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Navidrome dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à
  la suppression d'un module, cela ne détruit pas le cluster ou la ressource de calcul
  un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer.
  RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande de
  lancer **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne typique de 2-3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 42 $ US.** Déployez Navidrome, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps
  pendant lequel Navidrome a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé Navidrome et souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive,
  ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80
  crédits (8 $ US) dans votre propre projet, ou 72
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Navidrome resterait inutilisé pendant
  environ 6 jours ou plus dans votre propre projet (environ 1,40 $ US par
  jour), ou environ 1 jour ou plus dans un projet géré par RAD (67 crédits par
  jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Navidrome alors que quelque chose d'autre partage le
  projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de
  Navidrome dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Navidrome pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet
  le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Navidrome s'exécute comme un seul binaire Go servant du HTTP sur un port. Comme il n'a pas
de base de données externe, le déploiement connecte un ensemble plus restreint de services Google Cloud
qu'une application typique basée sur une base de données :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Un pod `StatefulSet` sur le port `4533`, 1 vCPU / 1 GiB par défaut |
| Données d'application | PVC de stockage en mode bloc (Persistent Disk, via `stateful_pvc_enabled`) | Prend en charge la base de données SQLite embarquée, le cache d'illustrations et l'index de recherche à `/data` — **pas** Cloud SQL |
| Bibliothèque musicale | Volume GCS FUSE fourni par l'opérateur ou Cloud Filestore (NFS) à `/music` | Fichiers audio source en lecture seule ; non provisionnés automatiquement |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est toujours créé mais reste **non monté** tant que le PVC de bloc par défaut gère `/data` |
| Secrets | Secret Manager | Un mot de passe administrateur auto-généré (`ND_DEVAUTOCREATEADMINPASSWORD`), injecté comme un Secret Kubernetes natif |
| Ingress | API Kubernetes Gateway / ClusterIP | Pas de `LoadBalancer` par défaut — interne uniquement jusqu'à ce qu'un domaine personnalisé ou un changement `service_type` soit configuré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Pas de base de données SQL.** `database_type` est fixé à `NONE` par `Navidrome_Common` ;
  chaque variable `db_*`/`database_*`/`sql_instance_*` dans ce module est transmise
  à la fondation uniquement pour des raisons de compatibilité structurelle et n'a aucun effet.
- **SQLite a besoin d'un vrai PVC de bloc, pas de `gcsfuse`.** Conformément à la convention de stockage de ce dépôt, `gcsfuse` ne peut pas sauvegarder en toute sécurité le modèle de verrouillage en écriture de SQLite. GKE offre ici à Navidrome un véritable avantage sur la variante Cloud Run : `stateful_pvc_enabled`
  par défaut à **`true`**, provisionnant un Persistent Disk par pod monté à `/data`
  (`ND_DATAFOLDER`) qui contient la base de données SQLite, le cache d'illustrations et l'index de recherche.
  Cela résout automatiquement la charge de travail en un `StatefulSet`.
- **La classe de stockage PVC est par défaut `standard-rwo` (SSD Balanced PD).** Cela consomme
  le quota régional strict `SSD_TOTAL_GB` documenté dans les conventions de stockage de ce dépôt. Le répertoire de données de Navidrome est de taille métadonnées/index, pas de taille média en vrac, donc le SSD est raisonnable ici — mais sur un projet soumis à des contraintes de quota, considérez `-var stateful_pvc_storage_class=standard` (HDD `pd-standard`) si vous atteignez
  `Quota 'SSD_TOTAL_GB' exceeded` sur une campagne plus large d'applications avec état.
- **La bibliothèque musicale n'est pas montée automatiquement.** `ND_MUSICFOLDER=/music` est défini
  comme une variable d'environnement, mais aucun volume n'est attaché à `/music` par défaut — vous devez ajouter
  un volume GCS FUSE en lecture seule (`gcs_volumes`) ou un montage NFS (`enable_nfs = true`,
  `nfs_mount_path = "/music"`) pointant vers vos fichiers audio source. Contrairement à `/data`,
  `/music` est en lecture seule et ne contient aucun état SQLite, donc `gcsfuse` est acceptable pour cela.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  Navidrome sert une bibliothèque SQLite partagée à partir d'un seul PVC ; il n'y a pas
  de mode multi-écriture/clustering, donc ne pas dépasser 1.
- **Pas d'ingress externe par défaut.** `service_type = "ClusterIP"` et
  `enable_custom_domain = true` mais avec une liste `application_domains` vide — donc
  par défaut, Navidrome n'est accessible qu'à l'intérieur du cluster/VPC. Définissez
  `application_domains` (Gateway + certificat géré) ou changez `service_type` en
  `LoadBalancer` pour l'exposer en externe.
- **Le compte administrateur est auto-créé.** `enable_admin_password = true` génère un
  mot de passe aléatoire, le stocke dans Secret Manager et l'injecte comme
  `ND_DEVAUTOCREATEADMINPASSWORD` afin que Navidrome crée l'utilisateur `admin` au premier
  démarrage. Définissez-le sur `false` pour utiliser l'assistant de configuration web de première exécution à la place.
- **Les sondes de santé atteignent le point de terminaison public `GET /ping`** (renvoie
  `{"status":"ok"}`, aucune authentification requise).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Navidrome {#a-gke-autopilot--the-navidrome-statefulset}

Avec le `stateful_pvc_enabled = true` par défaut, Navidrome se déploie comme un
`StatefulSet` (pas un `Deployment`) afin que son pod unique conserve une identité stable et un
PVC qui survit aux replanifications. Autopilot facture le CPU/la mémoire que le pod demande
réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Navidrome pour
  les pods, les révisions et les événements. Confirmez que le type de charge de travail indique `StatefulSet`.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment fonctionnent la planification Autopilot et la
résolution automatique `StatefulSet`-vs-`Deployment` en général.

### B. PVC de stockage en mode bloc — le volume de données SQLite {#b-block-storage-pvc--the-sqlite-data-volume}

Le PersistentVolumeClaim par pod à `/data` est la source unique de vérité pour
Navidrome : la base de données SQLite, le cache de métadonnées/illustrations, les fichiers temporaires de transcodage
(si activé) et l'index de recherche y résident tous. Perdre ce PVC entraîne la perte de vos
métadonnées de bibliothèque, listes de lecture, évaluations et utilisateurs (l'audio source lui-même n'est
pas affecté, car `/music` est un montage séparé, fourni par l'opérateur).

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims et
  PersistentVolumes ; Compute Engine → Disques pour voir le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Voir [App_GKE](App_GKE.md) Groupe 7 pour la mécanique complète de `stateful_pvc_*`
(classe de stockage, politique de gestion des pods, stratégie de mise à jour).

### C. Stockage de la bibliothèque musicale (GCS FUSE ou NFS) {#c-music-library-storage-gcs-fuse-or-nfs}

`/music` est l'endroit où Navidrome recherche les fichiers audio. Rien n'y est monté par
défaut — connectez soit un **volume GCS FUSE en lecture seule** (`gcs_volumes`,
basé sur le pilote CSI, acceptable ici car `/music` ne contient aucun état SQLite) pointant vers un bucket
d'audio téléchargé, soit un partage **Cloud Filestore (NFS)** (`enable_nfs = true`,
`nfs_mount_path = "/music"`) si vous avez besoin d'un accès en écriture depuis un autre hôte pour ajouter
des fichiers. Un bucket GCS `storage` séparé, toujours créé, existe pour la compatibilité
avec la variante Cloud Run mais reste non monté tant que le PVC de bloc sert `/data`.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~<service-name>"
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls /music
  ```

Voir [App_GKE](App_GKE.md) Groupes 13-14 pour les mécanismes de volume NFS et GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : le mot de passe administrateur, stocké sous
`secret-<prefix>-navidrome-admin-password` et injecté dans le pod comme un Secret Kubernetes natif
(non via le pilote CSI Secret Store) pour la variable d'environnement
`ND_DEVAUTOCREATEADMINPASSWORD`, que Navidrome lit au premier démarrage pour créer le
compte `admin`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration générale Secret Manager / Secret Store CSI
utilisée par les secrets d'autres applications.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, `service_type = "ClusterIP"` et `application_domains` est vide, donc
Navidrome n'est accessible que depuis l'intérieur du VPC/cluster
(`http://<service>.<namespace>.svc.cluster.local`). Définissez `application_domains` (avec
`enable_custom_domain = true`, déjà la valeur par défaut du module) pour provisionner une
passerelle Kubernetes avec un certificat TLS géré, ou changez `service_type` en
`LoadBalancer` pour une IP externe simple.

- **Console :** Kubernetes Engine → Services et Ingress ; Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) Groupe 19 pour l'API Gateway, l'IP statique et les mécanismes de nom d'hôte `nip.io` par défaut.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles (`uptime_check_config`
par défaut à `false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Navidrome {#3-navidrome-application-behaviour}

- **Pas de job d'initialisation/migration.** Navidrome n'a pas de base de données externe, il n'y a donc pas de
  job `db-init` ou de migration — le schéma SQLite est créé par le binaire lui-même au
  premier démarrage sur le PVC `/data` vide. `initialization_jobs` est par défaut à `[]`
  et n'est destiné qu'aux tâches personnalisées fournies par l'opérateur.
- **Amorçage administrateur.** Avec `enable_admin_password = true` (par défaut), le conteneur
  démarre avec `ND_DEVAUTOCREATEADMINPASSWORD` défini à partir du secret généré, et
  Navidrome crée automatiquement l'utilisateur `admin` avec ce mot de passe au premier démarrage. Avec
  `enable_admin_password = false`, la première personne à ouvrir l'interface web complète l'assistant de configuration et choisit ses propres identifiants administrateur — recommandé uniquement pour
  les déploiements internes au cluster, avec accès de confiance.
- **Identité PVC quasi-immuable.** Parce que le pod est un `StatefulSet`, le PVC est
  lié à l'identité stable du pod (`<service-name>-0`) et survit aux replanifications/redémarrages du pod. La mise à l'échelle de `max_instance_count` au-delà de 1 n'est pas prise en charge —
  Navidrome n'a pas de mode SQLite multi-écriture.
- **Chemin de santé.** La sonde de démarrage et la sonde de vivacité sont toutes deux **HTTP**
  `GET /ping`, un point de terminaison non authentifié renvoyant `{"status":"ok"}`. Attendez quelques
  minutes au premier démarrage pendant que l'analyse de la bibliothèque s'exécute (les grandes bibliothèques prennent plus de temps).
- **Analyse de la bibliothèque.** Navidrome analyse `/music` au démarrage et selon un calendrier périodique
  par la suite ; la progression et les résultats de l'analyse sont visibles dans les journaux des pods et l'interface web.
- **Vérifier la configuration en cours d'exécution et le montage de la bibliothèque :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep ^ND_
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls /music
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=50 | grep -i scan
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Navidrome sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `navidrome` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `deluan/navidrome` utilisé comme base de build personnalisé ; `latest` est épinglé à un tag connu et fonctionnel (`0.54.3`) au moment du build. |
| `application_display_name` | `Navidrome Music Server` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `enable_admin_password` | `true` | Génère automatiquement le mot de passe administrateur et crée l'utilisateur `admin` au premier démarrage via `ND_DEVAUTOCREATEADMINPASSWORD`. Définissez `false` pour utiliser l'assistant web de première exécution à la place. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU ; augmenter pour le transcodage à la volée, qui est lié au CPU. |
| `memory_limit` | `1Gi` | Navidrome conserve son index de recherche en mémoire ; dimensionner en fonction de la taille de la bibliothèque. |
| `min_instance_count` | `1` | Maintenir à 1 — évite les démarrages à froid pendant le chargement de l'index/de la bibliothèque. |
| `max_instance_count` | `1` | **Maintenir à 1.** Pas de support SQLite multi-écriture. |
| `enable_cloudsql_volume` | `false` | Navidrome n'a pas de base de données Cloud SQL — conserver `false`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` car `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | Accessible de l'extérieur par défaut — une IP externe est provisionnée. Définissez `ClusterIP` pour un accès interne uniquement, auquel cas accédez-y via un domaine personnalisé ou `kubectl port-forward`. |
| `session_affinity` | `None` | Pas de routage persistant nécessaire avec un seul réplica. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un véritable PVC de bloc à `/data` — requis pour que `gcsfuse` ne prenne jamais en charge la base de données SQLite embarquée. |
| `stateful_pvc_size` | `20Gi` | Dimensionné pour la base de données SQLite, le cache de métadonnées et l'index de recherche (pas la bibliothèque musicale, qui se monte séparément). |
| `stateful_pvc_mount_path` | `/data` | Doit correspondre à `ND_DATAFOLDER` de Navidrome. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD Balanced PD par défaut ; passer à `standard` (HDD) si le quota `SSD_TOTAL_GB` est contraint. |
| `stateful_fs_group` | `3000` | Correspond à la convention UID 1000/GID 2000 du graphique Helm de Navidrome, garantissant que le PVC est inscriptible par le groupe. |

### Groupe 13 — Stockage NFS {#group-13--nfs-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Activez et définissez `nfs_mount_path = "/music"` pour monter une bibliothèque musicale partagée et inscriptible via Cloud Filestore. |
| `nfs_mount_path` | `/mnt/nfs` | Pas `/music` par défaut — doit être remplacé si NFS est utilisé pour la bibliothèque. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée toujours le bucket `storage` ; il reste non monté tant que le PVC de bloc par défaut sert `/data`. |
| `gcs_volumes` | `[]` | Ajoutez une entrée en lecture seule avec `mount_path = "/music"` pour sourcer votre bibliothèque depuis GCS au lieu de NFS. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Navidrome_Common` — Navidrome n'a pas de base de données SQL ; toutes les autres variables `database_*`/`sql_*` sont inertes. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la ressource Gateway, mais n'a aucun effet tant que `application_domains` n'est pas vide. |
| `application_domains` | `[]` | Définir pour exposer Navidrome en externe via Gateway + certificat géré. |
| `reserve_static_ip` | `true` | IP stable une fois l'ingress externe (LoadBalancer ou Gateway) configuré. |

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
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à la phase. |
| `service_external_ip` | IP du LoadBalancer externe (lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Navidrome. |
| `navidrome_admin_password_secret_id` | ID du secret Secret Manager pour le mot de passe administrateur généré (vide lorsque `enable_admin_password = false`). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'opérateur. |
| `statefulset_name` | Nom du StatefulSet. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé avec un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver (ou sauvegarder `/data` avec `gcsfuse`) risque de corrompre le modèle de verrouillage en écriture de SQLite — corruption de la base de données, perte des métadonnées de la bibliothèque. |
| `stateful_pvc_storage_class` | `standard-rwo` (ou `standard` sous pression de quota) | Élevé | Le SSD consomme le quota régional strict `SSD_TOTAL_GB` ; une large campagne d'applications avec état peut l'épuiser — passer au HDD `standard` si tel est le cas. |
| `max_instance_count` | `1` | Critique | Navidrome n'a pas de mode SQLite multi-écriture ; la mise à l'échelle au-delà de 1 risque des écritures concurrentes sur le même PVC et une corruption de la base de données. |
| Volume `/music` (`gcs_volumes` ou `enable_nfs`) | Configurer explicitement | Élevé | Rien n'est monté à `/music` par défaut — l'analyse de la bibliothèque ne trouve aucun fichier et Navidrome sert un catalogue vide jusqu'à ce qu'un volume soit ajouté. |
| `enable_admin_password` | `true` pour tout déploiement accessible en externe | Élevé | `false` expose l'assistant de première exécution à quiconque atteint l'URL en premier — il devient administrateur. |
| `application_domains` / `service_type` | Définir l'un pour exposer en externe | Moyen | Le `ClusterIP` par défaut + `application_domains` vide laisse Navidrome accessible uniquement à l'intérieur du VPC — attendu pour un usage interne, surprenant si vous vouliez un accès public. |
| `stateful_pvc_size` | `20Gi` (augmenter pour les très grandes bibliothèques) | Moyen | Un sous-dimensionnement risque que la base de données/cache/index SQLite remplisse le PVC sur de grandes bibliothèques ; le pod n'étend pas automatiquement le stockage. |
| `quota_cpu_requests` / `quota_memory_requests` / etc. | N/A | Faible | Ces variables `quota_*` sont déclarées mais **non transmises** à la fondation par ce module — les définir n'a aucun effet ; seul `enable_resource_quota` est câblé (en revenant aux propres valeurs par défaut de quota d'App_GKE). |
| `memory_limit` | `1Gi` | Moyen | En dessous de ~512 Mo, le pod risque un OOM en conservant l'index de recherche en mémoire lors d'une analyse de grande bibliothèque. |
| `stateful_fs_group` | `3000` | Moyen | Un `fsGroup` non concordant peut rendre le PVC non inscriptible par l'UID non root de Navidrome, bloquant les écritures de la base de données au démarrage. |
| `backup_retention_days` | `7` (augmenter pour la production) | Faible | Trop court pour la rétention de conformité des sauvegardes `/data`. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Navidrome partagée avec la variante Cloud Run est
décrite dans **[Navidrome_Common](Navidrome_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Navidrome sur GKE Autopilot](../labs/Navidrome_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Navidrome sur Google Cloud Run](Navidrome_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Navidrome Common — Configuration d'application partagée](Navidrome_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Komga sur GKE Autopilot](Komga_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md) dans la solution **Bibliothèque numérique**.
