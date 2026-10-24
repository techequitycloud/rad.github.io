---
title: "ClassicPress sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de ClassicPress sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ClassicPress_GKE.md @ e69407af sha256:25c342312593 -->

# ClassicPress sur GKE Autopilot {#classicpress-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ClassicPress_GKE.png" alt="ClassicPress sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ClassicPress est un CMS gratuit, open-source et orienté métier — un fork léger de
WordPress 4.9.x qui préserve l'expérience d'édition classique (pré-Gutenberg), avec
des plugins, des thèmes, une bibliothèque de médias et une API REST. Ce module déploie ClassicPress sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par ClassicPress et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte ClassicPress sur RAD, et comment cela se compare {#what-classicpress-costs-on-rad-and-how-that-compares}

**Le module ClassicPress sur GKE Autopilot de RAD coûte environ 110,13 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 175 crédits (17,50 $ US).** ClassicPress est un fork léger de WordPress, antérieur à Gutenberg, destiné aux sites professionnels. Pour un coût moindre, le [guide Cloud Run](ClassicPress_CloudRun.md) exécute le même ClassicPress pour environ 83,61 $ US par mois ; choisissez GKE ici uniquement si ClassicPress doit rester actif en permanence, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de travail Kubernetes.

Si ClassicPress n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 110,13 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3–6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110,13 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2970 par mois (environ 297 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 110,13 $ US** |

### Comment cela se compare {#how-it-compares}

- Si vous l'exécutez vous-même, un VPS exécutant PHP, MySQL et ClassicPress vous coûtera moins cher en espèces : un Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go coûte environ 24 $ par mois, ou un GCP `e2-standard-2` environ 49 $ par mois — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, ce que Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence réside dans ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, ainsi que la possibilité de mettre ClassicPress en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).
- La majeure partie du coût d'exécution ci-dessus est la base de données MySQL gérée (et, le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison avec un VPS nu doit exécuter et sauvegarder manuellement.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si ClassicPress s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à ClassicPress dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, la VM ou les ressources GKE Autopilot une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne ClassicPress typique, contre les 180 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 110,13 $ US.** Déployez ClassicPress, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures où il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ClassicPress et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si ClassicPress devait rester inutilisé pendant environ 5 jours ou plus dans votre propre projet (3,67 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (99 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et le serveur de fichiers ou de cache partagé.** Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de ClassicPress alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

ClassicPress s'exécute comme une seule charge de travail web PHP/Apache construite à partir d'une image personnalisée légère
`FROM classicpress/classicpress`. Le déploiement connecte un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP/Apache sur le port 80, 1 vCPU / 2 Gio par défaut |
| Forme de la charge de travail | Kubernetes **StatefulSet** + PVC de bloc | `stateful_pvc_enabled = true` résout automatiquement `workload_type` en `StatefulSet` ; une PVC `standard-rwo` (SSD) de 10 Gio est montée à `/var/www/html` — l'installation complète de ClassicPress (code, plugins, thèmes, `wp-content`/téléchargements) réside sur ce volume par pod |
| Base de données | Cloud SQL pour MySQL 8.0 | Fixe — `ClassicPress_Common` code en dur `database_type = "MYSQL_8_0"` |
| Persistance de fichiers (secondaire) | Cloud Filestore (NFS) | Monté à `/var/www/html/wp-content` par défaut (`enable_nfs = true`) — un sous-chemin de la PVC StatefulSet ci-dessous ; c'est le mécanisme confirmé pour la persistance des téléchargements/plugins/thèmes (voir [Section 3](#3-classicpress-application-behaviour)) |
| Stockage d'objets | Cloud Storage | Un bucket `classicpress-uploads` est provisionné automatiquement mais n'est **pas** monté dans le pod par défaut |
| Secrets | Secret Manager | `CLASSICPRESS_SALT_SEED` auto-généré (dérive les 8 clés/salts d'authentification de style WordPress) ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré activés par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire et codé en dur.** `ClassicPress_Common`'s `config` définit
  `database_type = "MYSQL_8_0"` directement ; la variable `database_type` de la variante
  (par défaut `null`) ne prend effet que si elle est explicitement remplacée, et cela rompt
  le job `db-init` spécifique à MySQL et le point d'entrée. Laissez-le `null`.
- **Build personnalisé, non pré-construit.** `container_image_source` par défaut `"custom"` —
  Cloud Build produit une image légère `FROM classicpress/classicpress` qui greffe un
  shim de point d'entrée aliasant les variables `DB_*` injectées par la Fondation sur ClassicPress's
  `CLASSICPRESS_DB_*` et dérivant des salts d'authentification stables. L'image amont standard n'est
  jamais déployée directement.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur le bouclage.** La variante définit
  `DB_HOST = 127.0.0.1` ; un sidecar cloud-sql-proxy (`enable_cloudsql_volume = true`)
  écoute sur `127.0.0.1:3306`, et le point d'entrée alias les valeurs `DB_*` injectées
  sur `CLASSICPRESS_DB_*` (TCP, pas de SSL nécessaire pour MySQL).
- **Réplica unique, StatefulSet par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. Chaque pod obtient sa propre PVC via `stateful_pvc_enabled = true`
  (par défaut), donc une mise à l'échelle au-delà d'un réplica donnerait à chaque pod une copie *séparée* et non synchronisée
  de l'installation plutôt qu'une copie partagée.
- **NFS est également activé par défaut** (`enable_nfs = true`, monté à
  `/var/www/html/wp-content` — un sous-répertoire du montage PVC StatefulSet ci-dessous).
  ClassicPress lit/écrit les médias téléchargés, les plugins et les thèmes sous `wp-content`,
  et la logique de copie au premier démarrage du point d'entrée amont ignore explicitement un répertoire `wp-content` existant,
  donc ce montage est un chemin de persistance authentique et confirmé pour
  ces données — pas un stockage de rechange/inutilisé. Voir le tableau des pièges.
- **Pas d'auto-installation — la première connexion est manuelle.** `ClassicPress_Common` ne génère aucun
  secret de mot de passe administrateur et ne définit aucun drapeau d'auto-installation. ClassicPress crée son
  schéma et son compte administrateur via son propre installateur web au premier démarrage une fois que `db-init`
  a provisionné la base de données vide.
- **`CLASSICPRESS_SALT_SEED` est généré automatiquement** et stocké dans Secret
  Manager ; le point d'entrée dérive les 8 valeurs `AUTH_KEY`/`SALT` de style WordPress
  de manière déterministe, de sorte que les cookies et les sessions survivent aux redémarrages de pod.
- **La sonde de démarrage est généreuse (TCP, 20 tentatives)** pour laisser le temps au
  point d'entrée de l'image amont de remplir la PVC `/var/www/html` vide au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ClassicPress {#a-gke-autopilot--the-classicpress-workload}

ClassicPress s'exécute comme un **StatefulSet** (sélectionné automatiquement car `stateful_pvc_enabled`
par défaut `true`), planifié sur Autopilot, qui facture le CPU/la mémoire que le pod
demande réellement. Le réplica unique possède une PVC `standard-rwo` (SSD) dédiée.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail ClassicPress pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'
  IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE" --selector 'app~classicpress' 2>/dev/null || \
    kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet), et le Groupe 7 pour les mécanismes StatefulSet/PVC.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

ClassicPress stocke toutes les données de l'application (articles, pages, utilisateurs, options, paramètres de plugins/thèmes) dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de données de l'application, l'utilisateur et les autorisations, vérifie que l'utilisateur de l'application peut se connecter, puis arrête le sidecar.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe se trouvent tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Stockage — PVC StatefulSet, NFS et Cloud Storage {#c-storage--statefulset-pvc-nfs-and-cloud-storage}

Trois mécanismes de stockage distincts sont présents. La **PVC StatefulSet** (10 Gio,
`standard-rwo`, montée à `/var/www/html`) contient l'intégralité de l'installation de ClassicPress,
y compris les médias téléchargés — persistance de l'ensemble du webroot tant que le pod
conserve sa PVC. **NFS (Cloud Filestore)** est monté séparément à
`/var/www/html/wp-content` (`enable_nfs = true`), un sous-répertoire du montage PVC
ci-dessus ; la logique de copie du point d'entrée amont ignore explicitement un répertoire `wp-content`
existant, il s'agit donc d'un chemin de persistance authentique et confirmé pour les téléchargements/plugins/thèmes
spécifiquement — et non d'un montage inutilisé (voir le tableau des pièges). Un bucket **Cloud Storage**
(suffixe `classicpress-uploads`) est également provisionné mais n'est pas connecté au pod
en tant que montage `gcs_volumes` par défaut ; ajoutez une entrée à `gcs_volumes` pour l'utiliser.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims ; Filestore →
  Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT" --filter="name~classicpress-uploads"
  ```

Voir [App_GKE](App_GKE.md) Groupes 7, 13 et 14 pour le cycle de vie des PVC, la découverte NFS et
les mécanismes de montage GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret spécifique à ClassicPress est généré automatiquement et stocké dans Secret
Manager : `CLASSICPRESS_SALT_SEED`, une graine aléatoire de 64 caractères à partir de laquelle le
point d'entrée dérive les 8 valeurs de style WordPress `AUTH_KEY`/`SECURE_AUTH_KEY`/
`LOGGED_IN_KEY`/`NONCE_KEY` et leurs valeurs `SALT` correspondantes (SHA-256 de la graine
plus un suffixe fixe par clé). Le mot de passe de la base de données est géré séparément par la
fondation. Sur GKE, les secrets sont projetés dans les pods via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~classicpress"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et Ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements), et `enable_custom_domain = true` provisionne une ressource Ingress prête
pour un certificat géré par Google une fois que `application_domains` est renseigné.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ClassicPress {#3-classicpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il attend la connectivité TCP (ou un socket Cloud SQL),
  crée de manière idempotente la base de données de l'application, l'utilisateur et les autorisations, vérifie que l'utilisateur de l'application
  peut se connecter, puis arrête gracieusement le sidecar Cloud SQL Auth Proxy
  (`POST /quitquitquit`, en revenant à `SIGKILL`). Le job peut être réexécuté en toute sécurité
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration séparé — installation manuelle au premier démarrage.** Il n'y a pas de
  drapeau d'auto-installation pour ClassicPress. Une fois que `db-init` a provisionné la base de données vide,
  ClassicPress crée son propre schéma et son compte administrateur via l'installateur web au premier démarrage
  (`/wp-admin/install.php` dans l'image amont). Visitez l'URL du service après le premier déploiement et complétez l'installateur pour définir le nom d'utilisateur, le mot de passe et l'e-mail de l'administrateur — il n'y a pas de secret de mot de passe administrateur généré.
- **Alias de variables d'environnement de la base de données sur le bouclage.** La Fondation injecte `DB_HOST = 127.0.0.1`
  (le sidecar proxy), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; ClassicPress
  lit `CLASSICPRESS_DB_*`. Le build `entrypoint.sh` greffé
  `CLASSICPRESS_DB_HOST` en tant que `host:port` (ou une forme `localhost:<socket>` si un
  répertoire de socket Cloud SQL est trouvé) et alias le reste, avant de passer au
  `docker-entrypoint.sh` amont.
- **Les clés/salts d'authentification sont dérivés, non stockés individuellement.** `CLASSICPRESS_SALT_SEED`
  est le seul secret généré ; le point d'entrée calcule les 8 valeurs
  `CLASSICPRESS_AUTH_KEY` / `..._SALT` comme
  `sha256(seed-<key-name>)`, de sorte que chaque redémarrage et chaque pod (si vous mettez à l'échelle)
  s'accordent sur les mêmes valeurs sans persister l'état `wp-config.php`.
- **L'installation elle-même réside sur la PVC StatefulSet.** L'image amont
  `docker-entrypoint.sh` écrit `wp-config.php` et copie l'application ClassicPress
  dans `/var/www/html` au premier démarrage — ce qui, sur ce module, est une PVC de bloc
  `standard-rwo` de 10 Gio, et non un stockage de conteneur éphémère, de sorte que l'installation (plugins,
  thèmes et `wp-content/uploads`) survit aux redémarrages et au reschédulage des pods.
- **Le chemin de montage NFS est le mécanisme de persistance confirmé pour `wp-content`.**
  `enable_nfs = true` monte Filestore à `/var/www/html/wp-content` par défaut — un
  sous-répertoire de la PVC StatefulSet montée à `/var/www/html`. ClassicPress (un
  fork de WordPress) lit/écrit les médias téléchargés, les plugins et les thèmes sous
  `wp-content`, et la logique de copie au premier démarrage du point d'entrée amont ignore explicitement
  un répertoire `wp-content` existant, donc le montage NFS y est sûr et efficace.
  Sur ce module, la PVC persiste déjà l'ensemble du webroot par pod, donc le montage NFS
  est le plus précieux si `stateful_pvc_enabled` est un jour désactivé ou si une future
  mise à l'échelle multi-réplicas nécessite `wp-content` partagé entre les pods (la PVC est
  par pod, NFS est partagé).
- **Redis est optionnel et désactivé par défaut.** Lorsque `enable_redis = true`, laisser
  `redis_host` vide permet à l'injection `REDIS_HOST` de la Fondation (l'IP Redis de la VM NFS partagée lorsque `enable_nfs = true`) de prendre effet ; définir `redis_host`
  pointe explicitement ClassicPress vers une instance Redis/Memorystore externe à la place.
- **Chemins de santé.** La sonde de démarrage est **TCP** sur le port 80 avec un généreux
  `failure_threshold = 20` (le premier démarrage remplit la PVC vide avec l'application complète, ce qui peut prendre du temps) ; la sonde de vivacité est **HTTP** `GET /` avec un délai initial de 300 secondes — un 200 (site installé) ou une redirection 302 vers l'installateur (nouveau site) sont tous deux considérés comme sains.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep CLASSICPRESS_DB
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement (par leur
balise `{{UIMeta group=N}}`, et non par les commentaires de section du fichier `.tf`, qui sont
occasionnellement désynchronisés avec les balises). Seuls les paramètres spécifiques ou notables pour
ClassicPress sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `classicpress` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Correspond à la balise d'image `classicpress/classicpress`. Les balises sont qualifiées PHP (`php8.3-apache`, `php8.4-apache`), non qualifiées par version ; `latest` se résout en une balise qualifiée PHP épinglée au moment de la construction via l'argument de construction `CLASSICPRESS_VERSION` spécifique à l'application (l'argument de construction générique `APP_VERSION` injecté par la Fondation le remplacerait sinon silencieusement par la balise littérale et inexistante `"latest"`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit l'image légère `FROM classicpress/classicpress` avec le shim de point d'entrée greffé ; requis — l'image standard ne peut pas aliaser `DB_*` seule. |
| `cpu_limit` | `1000m` | Limite de CPU pour le conteneur ClassicPress. Augmenter pour les sites à fort trafic ou les plugins lourds. |
| `memory_limit` | `2Gi` | Limite de mémoire. Les applications de la famille WordPress nécessitent généralement ≥512 Mio ; plus pour les grandes bibliothèques de médias. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Gardez les deux à 1 — la PVC StatefulSet est par pod et non partagée. |
| `container_port` | `80` | ClassicPress fonctionne sur Apache, port 80. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; doit être ≤ `memory_limit`. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; gardez `post_max_size ≥ upload_max_filesize`. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (bouclage) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de ClassicPress. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement car `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | ClassicPress stocke toute son installation sous `/var/www/html` ; l'activation de cette option résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de la PVC par pod. Augmenter pour les grandes bibliothèques de médias. |
| `stateful_pvc_mount_path` | `/var/www/html` | Où réside l'installation de ClassicPress (code + `wp-content`/téléchargements). |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré basé sur SSD ; utilise le quota régional `SSD_TOTAL_GB`. Remplacer par `standard` (HDD) si le quota est limité. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type: TCP, path: "/", failure_threshold: 20, period_seconds: 15 }` | Seuil généreux — le premier démarrage remplit la PVC vide avec l'application complète. |
| `liveness_probe` | `{ type: HTTP, path: "/", initial_delay_seconds: 300 }` | Un 200 ou un 302 vers l'installateur sont tous deux considérés comme sains. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un stockage partagé basé sur Filestore monté à `nfs_mount_path` — le mécanisme de persistance confirmé pour les téléchargements/plugins/thèmes ; voir [Section 3](#3-classicpress-application-behaviour). |
| `nfs_mount_path` | `/var/www/html/wp-content` | Chemin de montage du conteneur pour le partage NFS, un sous-répertoire de la PVC StatefulSet. La logique de copie du point d'entrée amont ignore un répertoire `wp-content` existant, donc le montage ici est sûr. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active le backend de cache d'objets de style WordPress de ClassicPress. |
| `redis_host` | `""` | Laisser vide pour revenir à l'injection `REDIS_HOST` de la Fondation (l'IP Redis de la VM NFS lorsque `enable_nfs = true`) ; définir explicitement pour utiliser une instance Redis/Memorystore externe. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Codé en dur dans `ClassicPress_Common` ; laisser `null`. Le remplacer rompt le job `db-init` spécifique à MySQL et le point d'entrée. |
| `application_database_name` | `classicpress` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `classicpress` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress prêt pour un certificat géré une fois que `application_domains` est défini. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés — vide par défaut ; en ajouter un pour activer le certificat géré. |

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
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre ClassicPress. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `classicpress-uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution. ClassicPress exécute également ses propres préconditions (`validation.tf`) pour `upload_max_filesize ≤ post_max_size`, `min_instance_count ≤ max_instance_count`, Redis sans source d'hôte, IAP sans identifiants OAuth, et `enable_cloudsql_volume` avec `database_type = "NONE"`.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | Le job `ClassicPress_Common` et le point d'entrée `db-init` sont spécifiques à MySQL ; le remplacement par un moteur Postgres/SQL Server rompt les deux. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `CLASSICPRESS_SALT_SEED` (auto-généré) | Ne jamais changer | Critique | La modification de la graine après le premier démarrage invalide tous les cookies signés et les sessions connectées. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` | `10Gi` / `/var/www/html` | Critique | Cette PVC contient l'intégralité de l'installation (code + téléchargements) — la réduction de taille ou la perte de la PVC détruit le site ; le chemin de montage doit correspondre à l'endroit où le point d'entrée de ClassicPress écrit. |
| `max_instance_count` | `1` | Élevé | Chaque pod StatefulSet obtient sa propre PVC ; la mise à l'échelle au-delà de 1 donne à chaque réplica une copie séparée et divergente du site plutôt qu'une copie partagée. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité de la base de données sur GKE. |
| `enable_nfs` | `true` | Faible | Provisionne et paie une instance Filestore montée à `/var/www/html/wp-content` — le mécanisme confirmé pour la persistance des téléchargements/plugins/thèmes (voir [Section 3](#3-classicpress-application-behaviour)), en plus de la persistance par pod de la PVC StatefulSet pour le reste du webroot. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Moyen | Utilise le quota régional strict `SSD_TOTAL_GB`. Remplacer par `standard` (HDD `pd-standard`) sur les projets à quota limité — convient pour une charge de travail PHP/MySQL à faible IOPS. |
| Configuration admin au premier démarrage | Compléter `/wp-admin/install.php` rapidement après le déploiement | Moyen | Tant que l'installateur n'est pas exécuté, le site n'a pas de schéma et pas de compte administrateur — il n'y a pas de secret de mot de passe administrateur généré à récupérer. |
| `memory_limit` | `2Gi` | Moyen | En dessous de ~512 Mio, le pod PHP/Apache risque un OOM sous charge ou avec des plugins plus lourds. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et toute URL de site codée en dur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à ClassicPress partagée avec la variante Cloud Run est
décrite dans le module `ClassicPress_Common` (aucun guide `ClassicPress_Common.md` autonome
n'existe encore dans cet ensemble de documents).

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : ClassicPress sur GKE Autopilot](../labs/ClassicPress_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ClassicPress sur Google Cloud Run](ClassicPress_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [ClassicPress Common — Configuration d'application partagée](ClassicPress_Common.md) — la configuration partagée par les deux cibles de déploiement.
