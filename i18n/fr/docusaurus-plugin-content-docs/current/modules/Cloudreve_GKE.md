---
title: "Cloudreve sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Cloudreve sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Cloudreve_GKE.md @ e69407af sha256:5b151e39b65a -->

# Cloudreve sur GKE Autopilot {#cloudreve-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cloudreve_GKE.png" alt="Cloudreve sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cloudreve est une plateforme open-source populaire de stockage cloud et de
partage de fichiers auto-hébergée, écrite en Go. Elle fournit une interface
utilisateur web pour le téléchargement, l'organisation, la prévisualisation et
le partage de fichiers, avec des back-ends de stockage enfichables. Ce module
déploie Cloudreve sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Cloudreve utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Cloudreve sur RAD, et comment cela se compare {#what-cloudreve-costs-on-rad-and-how-that-compares}

**Le module Cloudreve sur GKE Autopilot de RAD coûte environ 42,08 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).** Cloudreve est une plateforme de stockage cloud et de partage de fichiers auto-hébergée. Pour le coût le plus bas, le [guide Cloud Run](Cloudreve_CloudRun.md) exécute le même Cloudreve pour environ 32,57 $ US par mois ; choisissez GKE ici uniquement si Cloudreve doit rester actif en continu, s'adapter à travers plusieurs pods, ou fonctionner aux côtés d'autres charges de travail Kubernetes.

Si Cloudreve n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que 42,08 $ US deviennent quelques dollars par mois à la place. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42,08 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, environ 2010 par mois (environ 201 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 42,08 $ US** |

### Comment cela se compare {#how-it-compares}

- Si vous l'exécutez vous-même, un VPS exécutant Cloudreve et son propre back-end de stockage coûte moins cher en espèces : une machine Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go coûte environ 24 $ par mois, ou un GCP `e2-standard-2` environ 49 $ par mois — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes d'argent — ce n'est généralement pas le cas. La différence réside dans ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, ainsi que la possibilité de mettre Cloudreve en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Cloudreve s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Cloudreve dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne démantèle pas les ressources GKE Autopilot une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne Cloudreve typique, contre les 80 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 42,08 $ US.** Déployez Cloudreve, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois, les builds, et les heures pendant lesquelles il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Cloudreve et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot maintient au moins un pod en cours d'exécution, il ne se met donc jamais à l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si Cloudreve resterait inutilisé pendant environ 6 jours ou plus dans votre propre projet (1,40 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (67 crédits par jour).
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Cloudreve s'exécute comme un seul binaire Go servant à la fois l'interface
utilisateur web et l'API de stockage de fichiers. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique sur le port 5212, `StatefulSet` par défaut |
| Persistance | Volume persistant de bloc (via `stateful_pvc_enabled`) | Monté à `/cloudreve` ; contient la base de données SQLite intégrée, `conf.ini`, et les fichiers téléchargés |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement, mais câblé comme un montage GCS FUSE uniquement lorsque le PVC de bloc est désactivé |
| Base de données | Aucune | Cloudreve utilise une base de données SQLite intégrée sur le volume de bloc — aucune instance Cloud SQL n'est créée |
| Secrets | Secret Manager | Aucun créé — le mot de passe administrateur de première exécution est généré par Cloudreve lui-même et imprimé dans les journaux du conteneur |
| Ingress | Kubernetes Gateway / Cloud Load Balancing | Domaine personnalisé activé par défaut ; IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL.** `database_type` est fixé à `NONE` par
  `Cloudreve_Common` ; chaque variable liée à Cloud SQL est transmise à la
  fondation uniquement pour la compatibilité de l'interface et n'a aucun effet.
- **`stateful_pvc_enabled = true` par défaut — requis, pas facultatif.**
  La base de données SQLite intégrée de Cloudreve et le stockage de fichiers local
  cohabitent dans son répertoire de travail, `/cloudreve`. Un montage GCS FUSE à cet
  endroit corromprait le verrouillage de fichiers de SQLite, donc le module utilise par
  défaut un PVC de bloc (`StatefulSet`) à la place ; `workload_type` n'a pas besoin
  d'être défini séparément.
- **La colocation binaire/données est gérée dans le build de l'image.** L'image
  `cloudreve/cloudreve` en amont conserve à la fois le binaire `cloudreve` et ses données
  dans `/cloudreve`. Le Dockerfile de ce module déplace le binaire vers
  `/usr/local/bin/cloudreve` dans un build multi-étapes (`ENTRYPOINT
  ["/usr/local/bin/cloudreve"]`, `WORKDIR /cloudreve`), de sorte que le montage du PVC
  à `/cloudreve` ne masque que les fichiers de données, jamais le binaire. Voir
  [Section 3](#3-cloudreve-application-behaviour).
- **Le volume GCS et le PVC de bloc sont mutuellement exclusifs au même chemin.** La
  variante ne monte le bucket `storage` auto-créé à `/cloudreve`
  (`enable_gcs_storage_volume = !stateful_pvc_enabled`) que lorsque le PVC de bloc est désactivé,
  évitant un conflit de double montage — avec la configuration stateful par défaut,
  ce bucket existe mais n'est **pas** monté dans le pod.
- **Pas de Cloud SQL, pas de Redis.** `enable_cloudsql_volume` par défaut `false` et
  `enable_redis` est explicitement remplacé par `false` dans `main.tf`.
- **Pas de secret administrateur injectable.** Cloudreve génère son propre mot de passe
  administrateur initial au premier démarrage et l'imprime dans les journaux du conteneur
  — aucun secret Secret Manager n'est créé ; `secret_ids`/`secret_values` sont des
  cartes vides.
- **Réplica unique par défaut.** `min_instance_count = max_instance_count =
  1`, correspondant à l'absence de support
  de clustering distribué/multi-nœuds de Cloudreve.
- **`enable_pod_disruption_budget` par défaut `true`** (inhabituel parmi les modules
  d'application), `pdb_min_available = "1"`, protégeant le pod stateful unique.
- **Le domaine personnalisé et l'IP statique sont activés par défaut**
  (`enable_custom_domain = true`, `reserve_static_ip = true`), contrairement à de nombreux
  autres modules d'application où ceux-ci sont désactivés par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region $REGION --project $PROJECT`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cloudreve {#a-gke-autopilot--the-cloudreve-workload}

Les pods Cloudreve sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que le pod demande réellement. Parce que `stateful_pvc_enabled = true` par défaut, la
charge de travail est un `StatefulSet` avec une identité de pod stable unique et un
PVC de bloc par pod, pas un `Deployment`.

- **Console :** Kubernetes Engine → Workloads → filtrez la charge de travail Cloudreve
  pour les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe / la route Gateway.
- **CLI :**
  ```bash
  kubectl get statefulsets,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et de la
décision du type de charge de travail Déploiement vs StatefulSet.

### B. Volume persistant de bloc (PVC StatefulSet) {#b-block-persistent-volume-statefulset-pvc}

La base de données SQLite intégrée de Cloudreve (`cloudreve.db`), les `conf.ini` générés,
et les fichiers téléchargés résident tous sous `/cloudreve`, le répertoire de travail du conteneur.
`stateful_pvc_enabled = true` provisionne un PVC de bloc par pod
(`stateful_pvc_storage_class = standard-rwo` par défaut, un PD équilibré basé sur SSD) monté à ce chemin
— un montage GCS FUSE ici briserait la sémantique de verrouillage de fichiers de SQLite,
donc le périphérique de bloc est obligatoire. Les téléchargements et les avatars sont conservés
dans `/cloudreve/data/` plutôt que dans les propres `/cloudreve/uploads` et `/cloudreve/avatar` de l'image :
l'image déclare ces deux-là comme VOLUMEs, que GKE sauvegarde avec un stockage de nœud éphémère
en plus du PVC, de sorte que les fichiers y disparaîtraient lors du remplacement du pod.
Le point d'entrée les lie en place et migre tout ce qui reste à l'ancien emplacement.

- **Console :** Kubernetes Engine → Stockage → filtrez le PVC Cloudreve ;
  Compute Engine → Disques affiche le disque persistant sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~cloudreve"
  ```

N'oubliez pas que la mise à l'échelle à zéro (`kubectl scale --replicas=0`) libère le CPU/la mémoire
mais **conserve le PVC** — seule la suppression du PVC (ou de l'espace de noms) libère
le quota SSD qu'il utilise. Voir [App_GKE](App_GKE.md) pour les mécanismes du groupe
StatefulSet / PVC et le compromis de classe de stockage SSD vs HDD.

### C. Cloud Storage {#c-cloud-storage}

Un bucket Cloud Storage `storage` est créé automatiquement par
`Cloudreve_Common`, mais il n'est monté dans le pod en tant que volume GCS FUSE
que lorsque `stateful_pvc_enabled = false` (évitant un double montage à `/cloudreve`
avec le PVC de bloc). Avec la configuration stateful par défaut, le bucket
existe mais reste inutilisé à moins que vous ne l'ajoutiez comme entrée `gcs_volumes`
explicite à un chemin de montage différent.

- **Console :** Cloud Storage → Buckets → filtrez le suffixe `storage` du déploiement.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et le pilote CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

`Cloudreve_Common` ne crée **aucun** secret Secret Manager pour Cloudreve
lui-même — le mot de passe administrateur de première exécution est généré
en interne par Cloudreve et imprimé dans les journaux du conteneur au premier
démarrage, et non stocké dans Secret Manager.
Tous les secrets que vous configurez via `secret_environment_variables` sont toujours
projetés via le mécanisme standard Secret Store CSI.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~cloudreve"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et les mécanismes de rotation
(la rotation n'a aucun effet ici car aucun secret de service n'existe).

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail utilise `enable_custom_domain = true` avec
`reserve_static_ip = true` (API Kubernetes Gateway avec un certificat géré par Google).
`service_type` par défaut `ClusterIP` — la Gateway, et non le
Service, est le point d'entrée externe à moins que vous ne passiez à `LoadBalancer`.

- **Console :** Services réseau → Équilibrage de charge / Gateways ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud
Monitoring. Des vérifications de disponibilité optionnelles et des politiques d'alerte sont disponibles
(`uptime_check_config.enabled` par défaut `false`).

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cloudreve {#3-cloudreve-application-behaviour}

- **Pas de job d'initialisation de base de données.** `Cloudreve_Common` n'injecte pas de
  job `db-init`/`db-create` par défaut — Cloudreve n'a pas de base de données SQL à
  provisionner. `initialization_jobs` n'exécute que les jobs que vous fournissez explicitement.
- **Auto-configuration au premier démarrage, mot de passe administrateur dans les logs.** Au premier démarrage, Cloudreve
  crée son schéma SQLite sur le volume monté et génère le compte administrateur initial,
  imprimant le mot de passe généré dans les logs du conteneur. Il n'y a pas d'étape de migration
  séparée et pas de secret Secret Manager pour le récupérer — capturez-le avec `kubectl logs`
  avant que le tampon de logs ne tourne, puis modifiez-le via l'interface web.
- **L'ombrage de volume est pré-corrigé dans le Dockerfile.** Sans le déplacement
  décrit dans la [Section 1](#1-overview), le montage du PVC de bloc à `/cloudreve`
  ombragerait le binaire colocalisé, produisant `exec ./cloudreve: no such
  file or directory` (CrashLoopBackOff). C'est un module
  **custom-build** (`container_image_source = "custom"`, `image_source = "custom"` dans
  `Cloudreve_Common`) précisément pour que cette correction (`modules/Cloudreve_Common/scripts/Dockerfile`)
  puisse être intégrée — ce n'est pas un simple passage de l'image amont.
  La modification du Dockerfile nécessite une reconstruction (`tofu taint
  'module.app_gke.module.app_build.null_resource.build_and_push_application_image[0]'`
  si un déclencheur de hachage de contenu manque le changement).
- **Le verrouillage de version utilise un ARG de build spécifique à l'application.** Le Dockerfile lit
  `CLOUDREVE_VERSION` (verrouillé à `3.8.3` lorsque `application_version =
  "latest"`), et non le générique `APP_VERSION` que la Fondation injecte et qui
  forcerait autrement la balise non résolvable `latest`.
- **Chemins de sonde de santé.** La sonde de démarrage est **HTTP** `GET /`
  (`initial_delay_seconds = 15`, `failure_threshold = 10`, c'est-à-dire jusqu'à ~100s
  pour être prête) ; la sonde de vivacité est également **HTTP** `GET /`
  (`initial_delay_seconds = 30`, `period_seconds = 30`). Cloudreve n'a pas de
  point de terminaison de santé dédié distinct de son interface web — `/` renvoie 200 une fois
  que le serveur est en service.
- **Réplica unique, sémantique `OrderedReady`.** Avec
  `stateful_pod_management_policy` laissé à sa valeur par défaut `null` → `OrderedReady`
  et `max_instance_count = 1`, un seul pod existe à la fois ; ne
  pas augmenter `max_instance_count` sans vérifier le support multi-nœuds/clustering
  de Cloudreve (non géré par ce module).
- **Inspecter la configuration en cours d'exécution et le déploiement du StatefulSet :**
  ```bash
  kubectl get statefulsets -n "$NAMESPACE"
  kubectl rollout status statefulset/<service-name> -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /cloudreve
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Cloudreve sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudreve` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Balise d'image `cloudreve/cloudreve` ; `latest` est épinglé à `3.8.3` au moment du build via l'ARG de build `CLOUDREVE_VERSION`. |
| `description` | `Cloudreve — self-hosted cloud storage / file-sharing system` | Rempli la description de la charge de travail GKE. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU alloué au conteneur Cloudreve. |
| `memory_limit` | `1Gi` | Mémoire allouée ; taille pour le service de fichiers et les transferts concurrents. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Cloudreve n'a pas de mode distribué/clustering — maintenez les deux à 1. |
| `container_port` | `5212` | Fixé par `Cloudreve_Common` ; la variable n'est pas transmise à App_GKE et n'a aucun effet. |
| `enable_cloudsql_volume` | `false` | Cloudreve n'a pas de base de données Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'accès externe passe par la Gateway (`enable_custom_domain`), et non par le Service, par défaut. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant configuré par défaut. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Requis** pour Cloudreve — sa base de données SQLite et ses téléchargements doivent résider sur un volume de bloc, pas sur gcsfuse. |
| `stateful_pvc_size` | `20Gi` | Taille pour la base de données SQLite et les fichiers téléchargés ; augmentez pour les bibliothèques plus grandes. |
| `stateful_pvc_mount_path` | `/cloudreve` | Répertoire de travail de Cloudreve — ne pas modifier sans également mettre à jour les attentes de chemin de données de l'application. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré basé sur SSD ; passez à `standard` (HDD) si le quota strict `SSD_TOTAL_GB` est une contrainte (voir [App_GKE](App_GKE.md)). |
| `stateful_fs_group` | `3000` | Correspond à la convention `fsGroup` du graphique Helm de Cloudreve (le conteneur s'exécute en tant que UID 1000/GID 2000) afin que le PVC soit inscriptible par le groupe. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut (inhabituel parmi les modules d'application) pour protéger le pod stateful unique. |
| `pdb_min_available` | `"1"` | Exige que le pod unique reste disponible pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, `initial_delay=15s`, `failure_threshold=10` | Pas de point de terminaison de santé dédié — Cloudreve sert `/` une fois prêt. |
| `liveness_probe` | HTTP `GET /`, `initial_delay=30s`, `period=30s` | Même point de terminaison que la sonde de démarrage. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le bucket `storage` auto-créé n'est monté à `/cloudreve` que lorsque `stateful_pvc_enabled = false` ; sinon, il existe inutilisé à moins d'être monté à un chemin différent ici. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut d'App_GKE) mais **remplacé par `false`** dans `main.tf` | Cloudreve n'utilise pas Redis ; la variable n'a aucun effet quelle que soit sa valeur. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Cloudreve_Common` — Cloudreve n'a pas de base de données SQL ; toutes les autres variables `database_*`/`db_*`/`sql_*` sont transmises uniquement pour la compatibilité de l'interface de la fondation et n'ont aucun effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut, contrairement à de nombreux autres modules d'application. |
| `reserve_static_ip` | `true` | Adresse externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | La valeur par défaut porte la balise `nfsserver` même si `enable_nfs` par défaut `false` pour Cloudreve — inoffensif à moins que NFS ne soit activé séparément. |

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
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Cloudreve. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, monté uniquement si `stateful_pvc_enabled = false`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (Cloudreve n'en injecte aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé
> avec un paramètre sans état, IAP sans identités autorisées,
> `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days`
> hors de portée. Une configuration invalide échoue la **planification** avec une erreur
> claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver sans fournir un montage de stockage de bloc équivalent permet à SQLite de résider sur gcsfuse (ou un disque éphémère), risquant une corruption de la base de données ou une perte totale de données lors de la recréation du pod. |
| `stateful_pvc_mount_path` | `/cloudreve` | Critique | Modifier cela en dehors du répertoire de travail de Cloudreve déconnecte le volume persistant de l'endroit où l'application lit/écrit réellement sa base de données et ses téléchargements. |
| Déplacement binaire du Dockerfile (`/usr/local/bin/cloudreve`) | Conserver tel que livré | Critique | Revenir à `ENTRYPOINT ["./cloudreve"]` à l'intérieur de `/cloudreve` réintroduit l'ombrage de volume : le montage du PVC de bloc masque le binaire et le pod CrashLoopBackOffs avec `exec ./cloudreve: no such file or directory`. |
| `max_instance_count` | `1` | Élevé | Cloudreve n'a pas de mode multi-nœuds/clustering vérifié dans ce module ; la mise à l'échelle au-delà de 1 risque des écritures concurrentes sur le même fichier SQLite (un seul pod possède réellement le PVC en mode StatefulSet `OrderedReady`, mais ne supposez pas que des nombres plus élevés sont sûrs). |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) ; `standard` (HDD) sous pression de quota | Moyen | Le SSD utilise le quota strict `SSD_TOTAL_GB`. La mise à l'échelle à zéro ne libère pas le PVC — seule la suppression le fait. |
| Récupération du mot de passe administrateur | Capturer depuis `kubectl logs` immédiatement après le premier démarrage | Moyen | Le mot de passe administrateur généré n'est imprimé dans les journaux du conteneur qu'une seule fois ; le manquer vous bloque l'accès au compte super-administrateur de première exécution jusqu'à la réinitialisation via le conteneur. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'adresse IP/Gateway externe peut changer lors des redéploiements, rompant le DNS et les liens favoris. |
| `gcs_volumes` à `/cloudreve` pendant que `stateful_pvc_enabled = true` | Éviter | Élevé | Un montage GCS FUSE et le PVC de bloc ciblant tous deux `/cloudreve` sont en conflit ; le module Common n'active le montage GCS que lorsque le PVC de bloc est désactivé. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Cloudreve
partagée avec la variante Cloud Run est décrite dans le module `Cloudreve_Common`
(`modules/Cloudreve_Common`) ; un guide `Cloudreve_Common.md` dédié
n'existe pas encore dans cet ensemble de documentation.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cloudreve sur GKE Autopilot](../labs/Cloudreve_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Cloudreve Common — Configuration d'application partagée](Cloudreve_Common.md) — la configuration partagée par les deux cibles de déploiement.
