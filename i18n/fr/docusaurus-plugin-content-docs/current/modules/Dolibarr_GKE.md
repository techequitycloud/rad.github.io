---
title: "Dolibarr sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Dolibarr sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Dolibarr_GKE.md @ e69407af sha256:4f28472aca66 -->

# Dolibarr sur GKE Autopilot {#dolibarr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dolibarr_GKE.png" alt="Dolibarr sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dolibarr est une suite ERP et CRM gratuite et open source couvrant les clients et prospects,
les devis, les commandes, les factures, les produits et stocks, les RH, les projets et la comptabilité via une
interface web PHP modulaire. Ce module déploie Dolibarr sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Dolibarr et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Dolibarr sur RAD, et comment cela se compare {#what-dolibarr-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Dolibarr sur RAD coûte environ 110,13 $ US par mois sans licence par utilisateur.** Cela se compare à environ 140 € par mois (10 utilisateurs) sur le plan Basic de DoliCloud, ou 180 € par mois sur son plan Premium. Un serveur auto-géré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Pour le coût le plus bas, le [guide Cloud Run](Dolibarr_CloudRun.md) exécute le même Dolibarr pour environ 83,61 $ US par mois. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 110,13 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **110,13 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2 970 par mois (environ 297 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 110,13 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| DoliCloud, plan Basic (10 utilisateurs) | 140 € par mois (14 €/utilisateur) | DoliCloud (hébergeur propre à Dolibarr) |
| DoliCloud, plan Premium (10 utilisateurs) | 180 € par mois (30 € + 15 €/utilisateur) | DoliCloud |
| **RAD, GKE Autopilot, votre propre projet** | **Environ 110,13 $ US** | Automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **Environ 297 $ US** | RAD |

- DoliCloud est l'hébergement officiel de Dolibarr, c'est donc la comparaison la plus directe dans ce guide — même logiciel, endroit d'exécution différent. Pour dix utilisateurs, RAD coûte moins des deux tiers du plan Basic de DoliCloud et moins de la moitié du plan Premium.
- Le prix de DoliCloud augmente avec chaque utilisateur ajouté ; le coût de RAD est l'infrastructure, qu'une équipe croissante n'atteint que lorsqu'elle a besoin de plus de capacité.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Dolibarr s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque
rien.** Cela convient bien mieux à Dolibarr dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou le pod GKE un par un — l'ensemble du projet,
  et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet
  peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Dolibarr, contre
  les 104 crédits (10,35 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 110,13 $ US.** Déployez Dolibarr, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et
  les heures pendant lesquelles Dolibarr était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD ne gère
  que pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés
  doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo
  conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur
  du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc
  très probablement supprimé dès que vous supprimez le projet — même si le projet lui-même est
  récupérable pendant 30 jours. Si vous avez personnalisé les données et souhaitez les conserver, copiez une sauvegarde
  (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le
  flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus
ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 114 crédits
  (11,45 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Dolibarr. La suppression permet d'économiser de l'argent une fois que Dolibarr resterait inutilisé
  pendant environ **3 jours ou plus** dans votre propre projet (environ 3,67 $ US par jour), ou environ
  **1 jour ou plus** dans un projet géré par RAD (99 crédits par jour).
- **Supprimez tout ce que Dolibarr utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de Dolibarr.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou sur un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose
  de Dolibarr dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Dolibarr pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ;
Frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration. [Tarifs DoliCloud](https://www.dolicloud.com/en-faq-pricing.php) pour les chiffres des plans Basic et Premium ;

## 1. Vue d'ensemble {#1-overview}

Dolibarr s'exécute comme une seule charge de travail web PHP/Apache. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache sur le port 80, 1 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les documents/PDFs téléchargés persistent sous `/var/lib/dolibarr`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `dolibarr-documents` provisionné automatiquement |
| Secrets | Secret Manager | `DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée
  (la variante passe `database_type = null`, qui conserve la valeur par défaut commune
  `MYSQL_8_0`) ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur loopback.** La variante définit
  `DB_HOST = 127.0.0.1` ; un sidecar cloud-sql-proxy (`enable_cloudsql_volume = true`)
  écoute sur `127.0.0.1:3306`, et le point d'entrée du wrapper aliasse le
  `DB_*` injecté sur `DOLI_DB_*`.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  Dolibarr conserve l'état de session et de verrouillage ; la charge de travail basée sur NFS est déployée avec la
  stratégie `Recreate`, donc ne pas dépasser 1 sans vérifier le comportement du stockage partagé.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/lib/dolibarr`)
  afin que les documents téléchargés et les PDF générés persistent et puissent être partagés entre les pods.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client atteignent le même pod.
- **Installation automatique au premier démarrage.** `DOLI_INSTALL_AUTO = 1` fait en sorte que l'installateur Dolibarr
  crée le schéma au premier démarrage ; il n'y a pas de job de migration séparé.
- **`DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` sont générés automatiquement**
  et stockés dans Secret Manager. Le mot de passe administrateur crée le compte super-administrateur de première exécution
  (nom d'utilisateur `DOLI_ADMIN_LOGIN`, par défaut `admin`).
- **`DOLI_URL_ROOT` n'est pas prédéfini sur GKE.** Définissez-le via `environment_variables` sur l'URL du LoadBalancer externe ou du domaine personnalisé après l'attribution de l'IP, afin que les liens absolus et les redirections de connexion se résolvent correctement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Dolibarr {#a-gke-autopilot--the-dolibarr-workload}

Les pods Dolibarr sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Comme la charge de travail est basée sur NFS, le déploiement utilise la
stratégie `Recreate` (une mise à jour progressive exécuterait deux pods sur le même volume NFS
et la même base de données partagée et provoquerait un blocage).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Dolibarr pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Dolibarr stocke toutes les données d'application (tiers, factures, produits, utilisateurs,
comptabilité) dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods y accèdent via le
sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du
premier déploiement, le job `db-init` crée la base de données d'application, l'utilisateur et les autorisations ;
l'installateur Dolibarr crée ensuite le schéma.

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

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `dolibarr-documents`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder l'accès. Séparément,
l'arborescence des documents de Dolibarr réside sur **NFS (Cloud Filestore)** à `/var/lib/dolibarr`,
partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets Dolibarr sont générés automatiquement et stockés dans Secret Manager :
`DOLI_ADMIN_PASSWORD` (le mot de passe du super-administrateur de première exécution) et
`DOLI_INSTANCE_UNIQUE_ID` (un sel de sécurité par instance). Le mot de passe de la base de données est
géré séparément par la fondation. Sur GKE, les secrets sont projetés dans les pods via
le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité et des stratégies d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Dolibarr {#3-dolibarr-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte à Cloud SQL (socket Unix sous `/cloudsql` via le
  sidecar Auth Proxy), crée de manière idempotente la base de données d'application, l'utilisateur et
  les autorisations, vérifie que l'utilisateur de l'application peut se connecter, puis arrête le sidecar proxy. Le
  job peut être réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Installation automatique au premier démarrage (pas de job de migration séparé).** Avec
  `DOLI_INSTALL_AUTO = 1`, l'image Dolibarr exécute son propre installateur au premier démarrage du pod,
  créant le schéma dans la base de données vide. Les mises à niveau de version exécutent les
  étapes de mise à niveau propres à l'image au démarrage.
- **Compte administrateur.** L'installateur crée un super-administrateur dont le nom d'utilisateur est
  `DOLI_ADMIN_LOGIN` (par défaut `admin`) et dont le mot de passe est le secret
  `DOLI_ADMIN_PASSWORD` généré. Récupérez-le avant la première connexion.
- **Alias de variable d'environnement DB sur loopback.** La plateforme injecte `DB_HOST = 127.0.0.1`
  (le sidecar proxy) et les autres valeurs `DB_*` ; Dolibarr lit `DOLI_DB_*`. Le
  point d'entrée du wrapper les aliasse et préfère les valeurs injectées aux
  valeurs par défaut `mysql`/`dolidb` intégrées à l'image.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour terminent l'ancien pod avant
  de démarrer le nouveau, évitant ainsi que deux pods ne se bloquent sur le volume NFS partagé et les
  verrous de la base de données.
- **Définissez `DOLI_URL_ROOT` une fois l'IP connue.** Il n'est pas prédéfini sur GKE — corrigez le
  déploiement ou définissez `environment_variables` sur l'URL externe une fois l'IP du LoadBalancer
  attribuée :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"dolibarr","env":[
      {"name":"DOLI_URL_ROOT","value":"https://dolibarr.example.com"}]}]}}}}'
  ```
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 80 ; la sonde de vivacité est **HTTP**
  `GET /` (la page de connexion renvoie 200 sans authentification). Prévoyez plusieurs minutes au premier
  démarrage pour l'installateur.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DOLI_DB
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Dolibarr sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dolibarr` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `dolibarr/dolibarr` utilisé comme base de build personnalisée ; `latest` est épinglé à un tag connu et fonctionnel (`23.0.3`) au moment du build. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les modules lourds/grandes bibliothèques de documents. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; conserver `post_max_size ≥ upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU minimum pour Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512 Mio ; 2 Gio recommandés pour la production. |
| `min_instance_count` | `1` | Maintenir à 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Maintenir à 1** sauf si le partage multi-pod est vérifié. |
| `container_port` | `80` | Dolibarr s'exécute sur Apache, port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Dolibarr. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut pour que les documents téléchargés persistent et soient partagés. |
| `nfs_mount_path` | `/var/www/documents` | Où Dolibarr stocke les documents/PDFs. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Conserve la valeur par défaut commune de MySQL 8.0. |
| `application_database_name` | `dolibarr` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `dolibarr` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

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
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Dolibarr. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment du plan — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | La sélection d'un moteur non-MySQL interrompt l'installateur et toutes les requêtes. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `DOLI_INSTANCE_UNIQUE_ID` (auto-généré) | Ne jamais changer | Critique | Changer le sel après le premier démarrage invalide les jetons signés et les URL cron. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les documents/PDFs téléchargés éphémères — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité de la base de données sur GKE. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans un comportement de stockage partagé/verrouillage vérifié risque des sessions fractionnées et des conflits de verrouillage NFS/DB. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions authentifiées. |
| `DOLI_URL_ROOT` (défini après que l'IP est connue) | URL du LoadBalancer/domaine externe | Élevé | Une URL racine incorrecte ou manquante interrompt les liens absolus et la redirection de connexion. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio, le pod PHP/Apache manque de mémoire sous charge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `DOLI_ADMIN_PASSWORD` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous bloque l'accès au premier compte super-administrateur jusqu'à la réinitialisation via la base de données. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui interrompt le DNS et `DOLI_URL_ROOT`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Dolibarr partagée avec la variante Cloud Run est
décrite dans **[Dolibarr_Common](Dolibarr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dolibarr sur GKE Autopilot](../labs/Dolibarr_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Dolibarr Common — Configuration d'application partagée](Dolibarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
