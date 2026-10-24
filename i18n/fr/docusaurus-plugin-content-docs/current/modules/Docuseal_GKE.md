---
title: "Docuseal sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Docuseal sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Docuseal_GKE.md @ e69407af sha256:c0f49802bcf5 -->

# Docuseal sur GKE Autopilot {#docuseal-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docuseal_GKE.png" alt="Docuseal sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

DocuSeal est une plateforme de signature de documents open source — une
alternative auto-hébergée à DocuSign pour créer, remplir et signer des documents
PDF avec un constructeur de formulaires visuel, des modèles réutilisables et
des pistes d'audit. Ce module déploie DocuSeal sur **GKE Autopilot** sur la
base du module [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par DocuSeal et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du module App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## Ce que coûte Docuseal sur RAD, et comment cela se compare {#what-docuseal-costs-on-rad-and-how-that-compares}

**Le module Docuseal sur GKE Autopilot de RAD coûte environ 149,81 $ US par mois, sans licence par utilisateur.** Cela se compare à 20 $ US par utilisateur et par mois pour le plan Pro hébergé de Docuseal. Un serveur auto-géré est moins cher en espèces, mais vous gérez alors vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Exceptionnellement pour ce catalogue, ce module GKE est en fait l'option la moins chère pour Docuseal — le [guide Cloud Run](Docuseal_CloudRun.md) par défaut maintient la puissance de calcul allouée en continu plutôt que de la réduire à zéro, ce qui coûte actuellement un peu plus cher (environ 180,87 $ US par mois) ; consultez ce guide uniquement si vous avez spécifiquement besoin de Cloud Run. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 149,81 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **149,81 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **111 crédits par jour**, soit environ 3 330 par mois (environ 333 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 149,81 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Docuseal, plan Pro (par utilisateur) | 20 $ US par mois | Docuseal |
| **RAD, GKE Autopilot, votre propre projet** | **Environ 149,81 $ US** | L'automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **Environ 333 $ US** | RAD |

- Le plan Pro de Docuseal est tarifé par signataire ; même avec cinq utilisateurs (100 $/mois), il coûte plus cher que le coût d'exécution du projet propre à RAD, et le coût de RAD ne change pas lorsque vous ajoutez un autre signataire.
- Le plan Basic de Docuseal est gratuit mais plafonné à 10 e-mails de demande de signature par mois ; le module de RAD exécute le même logiciel open source sans un tel plafond.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Docuseal s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Docuseal si vous n'en avez besoin qu'occasionnellement — pour étudier, une démo, une activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM NFS ou le pod GKE un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte **une poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Docuseal, contre les 162 crédits (16,20 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 149,81 $ US.** Déployez Docuseal, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles Docuseal était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé les données et que vous souhaitez les conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (17,95 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Docuseal. La suppression permet d'économiser de l'argent une fois que Docuseal resterait inutilisé pendant environ **4 jours ou plus** dans votre propre projet (environ 4,99 $ US par jour), ou environ **1 jour ou plus** dans un projet géré par RAD (111 crédits par jour).
- **Supprimez tout ce que Docuseal utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc les supprimer alors que quelque chose d'autre partage le projet n'économise que la partie calcul de Docuseal.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou sur un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Docuseal dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Docuseal pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes et la fenêtre de pause/restauration. [Tarification DocuSeal](https://www.docuseal.com/pricing) pour le chiffre du plan Pro ;

## 1. Vue d'ensemble {#1-overview}

DocuSeal s'exécute comme une seule charge de travail web Ruby on Rails (Puma). Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — DocuSeal ne prend pas en charge MySQL ou d'autres moteurs |
| Documents persistants | Filestore / NFS **ou** PVC de bloc | Les documents téléchargés se trouvent à `/data/docuseal` |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (pas le magasin de documents par défaut) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage.
- **`container_port = 3000` et les sondes doivent correspondre.** Sur GKE, l'environnement
  `PORT` **n'est pas** injecté (contrairement à Cloud Run), donc Puma utilise
  sa configuration par défaut de 3000. Si `container_port` ou les sondes pointent
  ailleurs, elles atteignent un port mort et le pod ne devient jamais Prêt même si
  l'application est saine.
- **Le sidecar Auth Proxy est utilisé sur GKE.** `enable_cloudsql_volume = true` exécute le
  sidecar Cloud SQL Auth Proxy, de sorte que DocuSeal atteint PostgreSQL via
  `127.0.0.1` (TCP simple, TLS terminé par le proxy) — le point d'entrée prend la
  branche de bouclage.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il
  ne doit jamais être renouvelé après le premier démarrage — cela invaliderait
  tous les cookies de session signés, déconnectant chaque utilisateur.
- **Les documents téléchargés nécessitent un volume persistant.** Par défaut,
  `enable_nfs = true` monte le volume NFS partagé à `/data/docuseal` ;
  alternativement, définissez `stateful_pvc_enabled = true` (sélectionne
  automatiquement un StatefulSet) avec `stateful_pvc_mount_path = /data/docuseal` pour un PVC de bloc
  par pod.
- **Minimum 1 réplica** (GKE ne prend pas en charge la mise à l'échelle à zéro) ;
  `session_affinity` par défaut à `ClientIP` et une IP statique est réservée
  afin que l'adresse du LoadBalancer survive aux redéploiements.
- **Pas de Redis.** DocuSeal utilise une file d'attente/cache basée sur PostgreSQL
  (`enable_redis = false`).
- **Les migrations s'exécutent au démarrage.** DocuSeal applique ses propres
  migrations ActiveRecord à chaque démarrage ; le seul job d'initialisation crée le
  rôle et la base de données PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail DocuSeal {#a-gke-autopilot--the-docuseal-workload}

Les pods DocuSeal sont planifiés sur Autopilot, qui facture le CPU/la mémoire
demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et maximal de réplicas. Lorsqu'un PVC de
bloc est activé, la charge de travail devient un StatefulSet.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail DocuSeal pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"           # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

DocuSeal stocke toutes les données d'application (modèles, soumissions,
soumissionnaires, utilisateurs, piste d'audit) dans une instance gérée de Cloud
SQL pour PostgreSQL 15. Les pods l'atteignent en privé via le sidecar
**Cloud SQL Auth Proxy** sur `127.0.0.1` ; aucune IP publique n'est exposée.
Lors du premier déploiement, un job d'initialisation crée la base de données et
le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Documents persistants — NFS ou PVC de bloc {#c-persistent-documents--nfs-or-block-pvc}

DocuSeal écrit les documents et pièces jointes téléchargés sur `/data/docuseal`.
Par défaut, cela est sauvegardé par le volume **NFS** partagé (`enable_nfs = true`) ;
alternativement, un **PVC de bloc** par pod (`stateful_pvc_enabled = true`, 10 GiB par défaut)
monté au même chemin le sauvegarde dans un StatefulSet.

- **Console :** Filestore → Instances (NFS) ; Kubernetes Engine → Stockage (PVC).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /data/docuseal
  ```

Voir [App_GKE](App_GKE.md) pour le modèle de découverte NFS et les modèles de
PVC StatefulSet.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** (suffixe de nom `storage`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder
l'accès. Le magasin de documents de DocuSeal utilise par défaut le volume
persistant ci-dessus, ce bucket est donc disponible pour une utilisation
auxiliaire plutôt que comme magasin de documents principal.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/           # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (utilisé par Rails pour signer les cookies de session et
autres valeurs signées). Le mot de passe de la base de données est géré
séparément par le module socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docuseal"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`) avec une IP statique réservée afin que l'adresse
survive aux redéploiements. Un domaine personnalisé avec un certificat géré par
Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (Rails écrit les logs sur stdout) sont
acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées
vers Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application DocuSeal {#3-docuseal-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte
  via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la base
  de données `docuseal`, accorde tous les privilèges, réaffecte la propriété du
  schéma `public` au rôle de l'application (PostgreSQL 15 n'accorde plus
  `CREATE` sur `public` par défaut), et signale au sidecar proxy de
  s'arrêter afin que le pod du job se termine. Le job peut être réexécuté en
  toute sécurité.
- **Migrations au démarrage.** DocuSeal exécute ses propres migrations
  ActiveRecord automatiquement à chaque démarrage en tant que rôle d'application,
  de sorte que la mise à niveau de la version de l'application applique les
  modifications de schéma sans étape de migration distincte.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une
  seule fois et écrit dans Secret Manager. Le renouveler invalide tous les
  cookies de session signés, forçant chaque utilisateur à se reconnecter. Ne le
  renouvelez que pendant une fenêtre de maintenance planifiée.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/up` — le point de terminaison de santé intégré de Rails, qui
  renvoie un `200` non authentifié une fois l'application démarrée. Les
  sondes s'exécutent sur le port 3000 ; comme GKE n'injecte pas `PORT`,
  `container_port` et le port de la sonde doivent tous deux être 3000.
- **Configuration initiale.** DocuSeal n'a pas d'identifiants par défaut. Une
  fois l'adresse IP du LoadBalancer attribuée, ouvrez l'URL du service et
  complétez l'écran de configuration pour créer le compte administrateur initial
  (e-mail + mot de passe) avant d'inviter des utilisateurs ou de créer des
  modèles.
- **Documents persistants.** Les documents téléchargés se trouvent à
  `/data/docuseal` sur le volume NFS (ou le PVC de bloc). Inspectez le montage
  depuis un pod :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /data/docuseal
  ```
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
DocuSeal sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docuseal` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image DocuSeal (`FROM docuseal/docuseal:<tag>`) ; épingler à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites et requêtes CPU/mémoire pour le conteneur DocuSeal. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE nécessite ≥ 1. |
| `max_instance_count` | `5` | Réplicas maximum. |
| `container_port` | `3000` | Puma écoute sur 3000 ; les sondes doivent correspondre. Ne pas modifier. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image DocuSeal dans Artifact Registry. |
| `container_image_source` | `custom` | Wrapper léger construit à partir de `docuseal/docuseal`. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales (`RAILS_LOG_TO_STDOUT`, `WORKDIR`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `SECRET_KEY_BASE` est injecté automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Sélectionne automatiquement le déploiement ; devient StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions d'interface utilisateur. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `database_type` | `POSTGRES_15` | Moteur PostgreSQL 15 fixe. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy → TCP de bouclage. Garder activé. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définir `true` pour un PVC de bloc par pod (sélectionne automatiquement StatefulSet) comme alternative à NFS. |
| `stateful_pvc_mount_path` | `/data/docuseal` | Chemin de montage du PVC — doit correspondre à `WORKDIR` de DocuSeal. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_fs_group` | `0` | fsGroup appliqué au volume PVC. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, délai 60s, timeout 10s, période 15s, 30 tentatives | Sonde de démarrage vers le point de terminaison de santé de Rails. |
| `liveness_probe` | HTTP `/up`, délai 60s, timeout 5s, période 30s, 3 tentatives | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job intégré `db-init` (crée le rôle + la base de données). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monter le volume NFS partagé à `/data/docuseal` pour les documents persistants (le modèle de persistance par défaut). |
| `nfs_mount_path` | `/data/docuseal` | Chemin de montage — doit correspondre à `WORKDIR` de DocuSeal. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | DocuSeal utilise une file d'attente/cache basée sur PostgreSQL ; laisser désactivé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `docuseal` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `docuseal` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

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
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre DocuSeal. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur du module socle [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un `Deployment`
> `workload_type` avec `stateful_pvc_enabled = true`, des unités `quota_memory_*` non binaires, IAP sans
> identités autorisées, un `database_type` qui ne correspond pas à une extension
> activée. Une configuration invalide échoue à la **planification** avec une
> erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment
> de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouvellement invalide tous les cookies de session signés — chaque utilisateur est déconnecté. |
| `enable_nfs` / `stateful_pvc_enabled` | Exactement un activé | Critique | Sans aucun des deux, les documents sont écrits sur le disque éphémère du pod et sont perdus au redémarrage/replanification. |
| `nfs_mount_path` / `stateful_pvc_mount_path` | `/data/docuseal` | Critique | Doit correspondre à `WORKDIR` de DocuSeal ; un chemin non concordant signifie que les documents sont écrits sur un stockage non persistant. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_port` | `3000` | Élevé | GKE n'injecte pas `PORT` ; un port non concordant fait que les sondes atteignent un port mort et le pod ne devient jamais Prêt. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy fournit le chemin de bouclage attendu par le point d'entrée ; le désactiver interrompt la connectivité de la base de données sur GKE. |
| `workload_type` | `null` / `StatefulSet` | Élevé | Forcer `Deployment` avec `stateful_pvc_enabled = true` échoue au moment de la planification. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions de signature en plusieurs étapes peuvent être acheminées vers différents pods. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `memory_limit` | `4Gi` | Moyen | Le rendu/la signature de PDF consomme beaucoup de mémoire ; une réduction trop importante risque un OOM sous charge. |
| `application_version` | Épingler en production | Moyen | `latest` peut tirer une nouvelle version majeure lors du redéploiement, appliquant des migrations que vous n'avez pas examinées. |

---

Pour le comportement du module socle référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à DocuSeal
partagée avec la variante Cloud Run est décrite dans
**[Docuseal_Common](Docuseal_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DocuSeal sur GKE Autopilot](../labs/Docuseal_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [DocuSeal sur Google Cloud Run](Docuseal_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [DocuSeal Common — Configuration d'application partagée](Docuseal_Common.md) — la configuration partagée par les deux cibles de déploiement.
