---
title: "PeerTube sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de PeerTube sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PeerTube_GKE.md @ e69407af sha256:3dc467047594 -->

# PeerTube sur GKE Autopilot {#peertube-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PeerTube_GKE.png" alt="PeerTube sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PeerTube est une plateforme d'hébergement vidéo open source et fédérée par
ActivityPub — une alternative auto-hébergée à YouTube où des instances
opérées indépendamment se suivent et fédèrent des vidéos, des commentaires et
des chaînes entre elles (et le reste du Fediverse) de la même manière que
Mastodon fédère les publications. Ce module déploie PeerTube sur **GKE
Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par PeerTube et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte PeerTube sur RAD, et comment cela se compare {#what-peertube-costs-on-rad-and-how-that-compares}

**Pour une seule instance, le module GKE Autopilot de PeerTube sur RAD coûte environ 143 $ US par mois, sans licence par utilisateur.** GKE convient à une instance PeerTube qui doit rester active, s'adapter à travers les pods ou fonctionner aux côtés d'autres charges de travail Kubernetes. Pour le coût le plus bas, le [module Cloud Run](PeerTube_CloudRun.md) exécute le même PeerTube pour environ 99 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que les 143 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **108 crédits par jour**, soit environ 3 240 crédits par mois (environ 324 $ US au prix de la recharge, 259 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 2 GiB | 72,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **environ 143 $ US**, ou environ 216 $ US sans le niveau gratuit |

- Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, il ne s'applique donc que si c'est votre seul cluster de ce type. Cloud SQL coûte le même prix en africa-south1 (Johannesburg) ; le pod et la VM coûtent environ 10 % de plus là-bas.
- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod PeerTube est toujours en cours d'exécution, donc le coût ci-dessus est le même, que quelqu'un l'utilise ou non ; des pods supplémentaires ne sont ajoutés que sous charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- PeerTube est géré par des opérateurs indépendants plutôt que vendu comme un SaaS commercial unique, il n'y a donc pas de prix de fournisseur unique à citer ici ; cette comparaison se fait plutôt avec un serveur nu.
- Un VPS nu dimensionné près de l'empreinte de PeerTube — Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go Droplet, tous deux à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois — est moins cher en espèces que l'un ou l'autre des chiffres RAD ci-dessus, et le stockage/l'égression vidéo est facturé séparément dans tous les cas.
- Le stockage d'objets de RAD basé sur Cloud Storage, les sauvegardes Cloud SQL et la file d'attente de jobs Redis sont gérés pour vous ; sur un VPS nu, la croissance du stockage, les sauvegardes et la file d'attente de transcodage sont votre propre travail.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si PeerTube s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, un environnement de démonstration, une activité saisonnière — que de faire fonctionner PeerTube en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, aucune VM ou le cluster GKE un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les 115 crédits (11,50 $ US) que coûte un redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 143 $ US.** Déployez PeerTube, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps pendant lequel PeerTube a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et que RAD gère uniquement pour la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes de PeerTube sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probablement supprimé dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à PeerTube que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot ne s'adapte pas à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 $ US), car RAD recrée le projet et les services partagés avant PeerTube. La suppression permet d'économiser de l'argent seulement si PeerTube devait rester inutilisé pendant environ 3 jours ou plus, à la fois dans votre propre projet (environ 4,75 $ US par jour) et dans un projet géré par RAD (108 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée.** Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de PeerTube alors que quelque chose d'autre partage le projet n'économise que la partie calcul de PeerTube.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de labo, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite fixée par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

PeerTube s'exécute comme un pod Node.js personnalisé sur GKE Autopilot, construit à partir d'un Dockerfile superposé à l'image de base officielle `chocobozzz/peertube` afin qu'un ARG de build `PEERTUBE_VERSION` dédié puisse épingler une version réelle. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js sur le port 9000 ; 2 vCPU / 2 GiB par défaut (conservateur — augmenter pour un transcodage réel) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — extensions `pg_trgm`/`unaccent` pré-créées ; PeerTube migre son propre schéma ; sidecar Cloud SQL Auth Proxy |
| Cache et file d'attente | Redis | **Obligatoire, non optionnel** — la file d'attente de jobs BullMQ de PeerTube (transcodage, livraison de fédération, notifications) n'a pas de repli en mémoire |
| Stockage d'objets | Cloud Storage | Un bucket public `videos` (compatible S3, identifiants HMAC) pour les fichiers vidéo/listes de lecture en streaming ; un bucket privé `data` (GCS FUSE, avec un correctif UID/GID explicite) pour l'état local |
| Secrets | Secret Manager | Paire de clés d'accès/secrètes HMAC S3, `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD` auto-générées ; mot de passe de la base de données |
| Ingress | Kubernetes Service / Gateway | Service `LoadBalancer` par défaut — public requis pour la fédération ; domaine personnalisé optionnel via Kubernetes Gateway |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Redis est obligatoire.** Le pipeline de transcodage, de livraison de fédération et de notification de PeerTube passe par une file d'attente de jobs BullMQ in-process sans repli en mémoire — contrairement à la plupart des modules de ce catalogue où Redis est un bouton de performance/mise à l'échelle optionnel. `enable_redis = true` est la valeur par défaut et ne doit jamais être désactivée ; une précondition au moment du plan bloque `enable_redis = true` sans que `redis_host` ne soit défini ni `enable_nfs = true`.
- **Ce module a corrigé un véritable bug de permission de stockage spécifique à GKE.** Le point d'entrée du fournisseur de PeerTube s'exécute en tant que root et `chown` `/data` à l'utilisateur `peertube` (uid/gid **999**) avant de réduire les privilèges — ce `chown` dans le conteneur fonctionne bien sur l'intégration gcsfuse propre à Cloud Run, mais **le pilote CSI GCS FUSE de GKE ne l'honore pas**, laissant le montage appartenant à root. Voir le §3 pour l'histoire complète et le correctif.
- **GKE est la bonne cible pour une charge de transcodage réelle.** Contrairement à la variante Cloud Run (délibérément limitée au VOD/transcodage léger), le modèle de calcul soutenu de GKE et la capacité de ce module à augmenter `cpu_limit`/`memory_limit` bien au-delà de l'économie de mise à l'échelle à zéro en font le meilleur endroit pour le transcodage de production — la FAQ de PeerTube elle-même recommande jusqu'à 8 vCPU / 8 Gi.
- **Le streaming en direct RTMP n'est pas câblé dans cette passe — mais il n'est pas architecturalement bloqué ici comme il l'est sur Cloud Run.** `enable_live_streaming` par défaut `false` et n'a actuellement aucun effet : les services Cloud Run ne peuvent jamais router du TCP brut (un plafond architectural absolu), mais le modèle de réseau de GKE *peut* exposer des ports TCP supplémentaires via des ports de service LoadBalancer supplémentaires — ce câblage n'est tout simplement pas encore implémenté.
- **Le bucket `videos` est délibérément public.** L'architecture propre de PeerTube exige que les navigateurs récupèrent les fichiers vidéo/listes de lecture en streaming directement depuis le stockage d'objets, et non via l'application — le bucket remplace la valeur par défaut sécurisée de la fondation `public_access_prevention = "enforced"` par `"inherited"` afin que l'autorisation `allUsers:objectViewer` requise puisse s'appliquer (le même correctif déjà prouvé sur la variante Cloud Run — voir [PeerTube_CloudRun](PeerTube_CloudRun.md) §3).
- **Sur un projet géré par RAD en libre-service, une substitution de politique d'organisation au niveau du projet est appliquée en premier, puis attendue.** Les projets gérés par RAD héritent d'une politique d'organisation de dossier qui applique `constraints/storage.publicAccessPrevention`, ce qui remplace le paramètre de niveau de bucket ci-dessus et réintroduit le même `412`. Lorsque `is_self_serve_project = true` (injecté par le serveur — ne le définissez jamais manuellement ; il est `false` pour un projet ordinaire que vous apportez, où tout ce mécanisme est une opération nulle), le module remplace cette contrainte au niveau du **projet** via le fournisseur guardrails-admin. La substitution est liée à l'état propre de ce module, donc la destruction du déploiement ramène le projet à la posture par défaut appliquée par le dossier. **La substitution a besoin d'environ 90 secondes pour se propager avant que l'octroi du bucket ne réussisse.** Terraform signale l'écriture de la politique d'organisation comme terminée en 0s, mais l'application de GCP est en retard : l'étape d'application suivante a toujours rencontré le même `412`, même après que la propre tentative/réessai IAM intégrée du fournisseur (~30s, `Too many
  conflicts`) ait été épuisée. Un `time_sleep.wait_for_org_policy_propagation` de 90s se situe entre les deux, et l'octroi du bucket dépend de l'attente plutôt que de la substitution directement — donc une application sur un projet en libre-service est ~90s plus lente par conception. Confirmé en direct le 2026-08-06 sur la variante Cloud Run, qui provisionne ses buckets via le même chemin de fondation.
- **Point sensible : la substitution est limitée au projet, donc deux variantes PeerTube dans un même projet entrent en collision.** `storage.publicAccessPrevention` n'a pas de variante limitée au bucket une fois appliquée à un niveau supérieur. Si le même projet exécute à la fois `PeerTube_GKE` et `PeerTube_CloudRun`, l'état de chaque module gère indépendamment le *même* objet de politique au niveau du projet, et la destruction de l'un supprime l'autre. `solutions.yaml` ne sélectionne toujours qu'une seule variante PeerTube par solution, donc c'est rare en pratique et n'est pas résolu dans le module.
- **`host` (le domaine de fédération ActivityPub) est immuable après la première utilisation réelle.** Laissé vide par défaut afin que le point d'entrée le dérive de l'URL de service prédite d'App_GKE — fonctionne dès la sortie de la boîte sur un nouveau déploiement. Définissez un vrai domaine personnalisé avant l'utilisation en production.
- **Aucun job d'initialisation d'amorçage d'administrateur n'est nécessaire.** `PT_INITIAL_ROOT_PASSWORD` est lu directement depuis `process.env` par le propre `installer.ts` de PeerTube au premier démarrage lorsqu'aucun utilisateur n'existe encore — le compte `root` est créé automatiquement.
- **La connexion à la base de données utilise la boucle de rappel du Cloud SQL Auth Proxy, non chiffrée.** Contrairement à la variante Cloud Run (qui doit remplacer `PEERTUBE_DB_SSL` par `true` avec la vérification des certificats désactivée, puisque Cloud Run alias l'IP privée brute de Cloud SQL), le mécanisme `db_host_env_var_name` d'App_GKE préfère la boucle de rappel `127.0.0.1` du sidecar cloud-sql-proxy lorsqu'elle est présente — donc la valeur par défaut partagée `PeerTube_Common` de `PEERTUBE_DB_SSL="false"` est déjà correcte ici, non modifiée.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Les noms de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail PeerTube {#a-gke-autopilot--the-peertube-workload}

- **Console :** Kubernetes Engine → Workloads → sélectionnez le déploiement.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour Workload Identity, l'autoscaling et les mécanismes de déploiement.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

PeerTube stocke toutes les données de l'application (comptes, métadonnées des vidéos, commentaires, abonnements, listes de lecture) dans une instance Cloud SQL pour PostgreSQL 15 gérée, accessible via un sidecar Cloud SQL Auth Proxy sur `127.0.0.1`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~peertube"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis — la file d'attente de jobs BullMQ {#c-redis--the-bullmq-job-queue}

Redis soutient la file d'attente de jobs de transcodage, de livraison de fédération et de notification de PeerTube. Lorsque `redis_host` est laissé vide, l'IP de la VM du serveur NFS partagé est utilisée comme hôte Redis par défaut.

- **CLI :**
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -i PEERTUBE_REDIS
  ```

### D. Cloud Storage — `videos` (public) et `data` (privé, GCS FUSE) {#d-cloud-storage--videos-public-and-data-private-gcs-fuse}

Deux buckets GCS sont provisionnés :

- **`videos`** — public (`public_access_prevention = "inherited"`,
  `allUsers:objectViewer`), compatible CORS, accessible via le client natif de PeerTube
  compatible S3 (AWS SDK) contre le point de terminaison XML d'interopérabilité S3 de GCS
  en utilisant des identifiants HMAC d'un compte de service dédié. Contient les cinq
  classes de stockage d'objets de PeerTube (web-videos, streaming-playlists,
  original-video-files, user-exports, captions) sous des préfixes distincts.
- **`data`** — privé, monté via le **pilote CSI GCS FUSE** à `/data`
  avec des options de montage `uid=999,gid=999,file-mode=664,dir-mode=775` explicites
  (voir §3 pour comprendre pourquoi cela est porteur sur GKE). Contient l'état local
  de PeerTube (non-stockage d'objets) : avatars, miniatures, aperçus, storyboards,
  torrents, plugins, journaux et tmp/cache.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
  gcloud storage ls gs://<videos-bucket>/
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```

Voir [App_GKE](App_GKE.md) pour GCS Fuse et les options CMEK.

### E. Secret Manager {#e-secret-manager}

Le pod de PeerTube lit `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`
(consulté uniquement au premier démarrage lorsqu'aucun utilisateur n'existe), la paire de clés d'accès/secrètes HMAC S3, et — lorsque le SMTP est configuré — un mot de passe SMTP, le tout sous forme de variables d'environnement basées sur des secrets. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~peertube"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails d'injection et de rotation, et
[PeerTube_Common](PeerTube_Common.md) pour la liste complète des secrets.

### F. Réseau et ingress {#f-networking--ingress}

Le service Kubernetes utilise par défaut `service_type = "LoadBalancer"` (requis
pour la fédération ActivityPub publique et la livraison de vidéos). Un projet soumis à des quotas peut définir `service_type = "ClusterIP"` et vérifier via
`kubectl port-forward` au lieu de consommer le quota d'IP externes/statiques. Une
passerelle Kubernetes avec un domaine personnalisé, Cloud CDN (utile pour la
livraison de vidéos) et Cloud Armor peuvent être superposés.

- **Console :** Kubernetes Engine → Gateways, Services & Ingress.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application PeerTube {#3-peertube-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute
  `scripts/peertube/db-init.sh` en utilisant `postgres:15-alpine`. Il attend que
  Cloud SQL accepte les connexions, puis crée de manière idempotente le rôle et la base de données de l'application, accorde les privilèges et crée les extensions `pg_trgm` et
  `unaccent` en tant que superutilisateur postgres — le guide d'installation de PeerTube
  requiert les deux mais ne les crée pas lui-même. Peut être réexécuté en toute sécurité
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration séparé.** PeerTube crée et migre son propre schéma Sequelize automatiquement à chaque démarrage du serveur.
- **Le compte administrateur s'amorce automatiquement — aucune action manuelle n'est nécessaire.** Contrairement à certaines applications ActivityPub de ce catalogue (GoToSocial nécessite un job CLI manuel), le `installer.ts` de PeerTube lit `PT_INITIAL_ROOT_PASSWORD` directement depuis `process.env` (pas node-config, donc pas de préfixe `PEERTUBE_`) au premier démarrage lorsqu'aucun utilisateur n'existe encore, et crée automatiquement le compte administrateur `root` avec ce mot de passe. Récupérez-le :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~root-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
  Connectez-vous à `$SERVICE_URL/login` avec le nom d'utilisateur `root`.
- **Le domaine de fédération (`host`) est immuable après une utilisation réelle.**
  `PEERTUBE_WEBSERVER_HOSTNAME` est intégré à chaque URI d'acteur/objet ActivityPub créé localement la première fois que le serveur démarre avec des données réelles. Lorsque `host` est laissé vide, `docker-entrypoint.sh` le dérive de l'URL `GKE_SERVICE_URL` d'App_GKE au démarrage du conteneur — une valeur par défaut fédérée fonctionnelle ne nécessitant aucune décision de domaine avant le déploiement. Définissez un vrai domaine personnalisé via `host` avant l'utilisation en production ; le modifier après l'existence de comptes/vidéos réels nécessite le propre script de maintenance `update-host` de PeerTube et ne corrige pas rétroactivement les URI déjà fédérés.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 9000 — les propres migrations DB/Redis de PeerTube et l'amorçage de l'administrateur au premier démarrage peuvent prendre plus de temps que ne le permet une fenêtre de disponibilité HTTP typique, et une sonde HTTP contre une API pas encore prête empêcherait le pod de devenir jamais prêt. La sonde de vivacité utilise le point de terminaison public et non authentifié `GET /api/v1/config`.

### ⚠ Le bug UID/GID de GCS-FUSE — le piège spécifique à GKE que ce module corrige {#-the-gcs-fuse-uidgid-bug--the-gke-specific-gotcha-this-module-fixes}

Le point d'entrée de l'image du fournisseur de PeerTube (`support/docker/production/entrypoint.sh`)
s'exécute en tant que **root** et `chown` `/data` à l'utilisateur `peertube` — UID/GID confirmé **999** via `docker run --entrypoint sh chocobozzz/peertube:production
-c "id peertube"` — avant de réduire les privilèges pour exécuter le serveur en tant que cet utilisateur.

- **Sur Cloud Run**, ce `chown` dans le conteneur est suffisant — l'intégration gcsfuse intégrée de Cloud Run le tolère, et le montage se retrouve correctement possédé sans configuration supplémentaire.
- **Sur GKE**, le **pilote CSI GCS FUSE n'honore pas un `chown` dans le conteneur.** Sans une option de montage `uid=`/`gid=` explicite, le volume est monté en tant que root et le reste, quelle que soit l'action du point d'entrée par la suite — ainsi, la propre tentative de PeerTube d'écrire dans son `/data` désormais possédé par root échoue immédiatement :
  ```
  Error: EACCES: permission denied, mkdir '/data/logs'
  ```
  Cela provoque une boucle de crash du pod à chaque redémarrage, avant même que le serveur ne lie son port.

Le `PeerTube_Common` partagé `_peertube_data_volume` local (dans
`modules/PeerTube_Common/main.tf`, utilisé par **les deux** variantes Cloud Run et GKE) corrige cela en épinglant des options de montage explicites :

```hcl
mount_options = [
  "implicit-dirs",
  "stat-cache-ttl=60s",
  "type-cache-ttl=60s",
  "uid=999",
  "gid=999",
  "file-mode=664",
  "dir-mode=775",
]
```

C'est une opération nulle sur Cloud Run (root chown déjà aux mêmes ID là-bas) et
porteuse sur GKE. C'est la même classe de bug déjà trouvée et corrigée sur les variantes GKE de Paperless, CodeServer, CloudBeaver et Seerr de ce catalogue (voir la découverte "GKE gcsfuse UID/GID permission denied" du dépôt `CLAUDE.md`) — PeerTube est la dernière instance confirmée, et la première où l'UID non concordant (999, pas le plus courant 1000) provenait du propre `chown` du point d'entrée du fournisseur plutôt que du `USER` déclaré de l'image.

**Vérifié en direct, 2026-07-22 :**

```bash
kubectl get pods -n "$NAMESPACE" -l app=<service-name>
# 3/3 Running, 0 restarts (down from 5 before the fix)

kubectl logs -n "$NAMESPACE" <pod> | head -20
# HTTP server listening on 0.0.0.0:9000
# Creating the administrator ... Username: root

POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /data
# every entry (logs/, avatars/, torrents/, plugins/, ...) owned peertube:peertube

kubectl port-forward -n "$NAMESPACE" "$POD" 19000:9000 &
curl -s http://localhost:19000/api/v1/config | head -c 200      # 200, real JSON
curl -s http://localhost:19000/api/v1/config/about | head -c 200 # 200, real JSON
```

**Indicateur de diagnostic**, si vous rencontrez ce symptôme sur un fork de ce module :

```bash
kubectl describe pod -n "$NAMESPACE" <peertube-pod>
# Look for: Error: EACCES: permission denied, mkdir '/data/logs'
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement (correspondant à la balise `{{UIMeta group=N}}` de chaque variable dans `variables.tf`). Seuls les paramètres spécifiques ou notables pour PeerTube sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `peertube` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `PeerTube` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Se résout en la balise Docker Hub `production` maintenue via l'ARG de build `PEERTUBE_VERSION` dédié — pas le générique `APP_VERSION` de la Fondation (qui autrement gagnerait la fusion et produirait une balise `latest` non résolvable). |
| `host` | `""` | `PEERTUBE_WEBSERVER_HOSTNAME` — le domaine de fédération public. **Immuable après la première utilisation réelle.** Laissé vide, il le dérive de l'URL de service GKE prédite. |
| `admin_email` | `admin@example.com` | E-mail attribué au compte administrateur `root` auto-créé. |
| `enable_open_registration` | `false` | Autoriser les nouveaux utilisateurs à s'inscrire. |
| `enable_live_streaming` | `false` | Présent pour la symétrie du schéma ; non câblé dans cette passe — voir §1/§3. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit une image basée sur Dockerfile (base `chocobozzz/peertube:${PEERTUBE_VERSION}`) via Cloud Build. |
| `cpu_limit` | `2000m` | Valeur par défaut conservatrice pour l'utilisation démo/VOD. La FAQ de PeerTube recommande jusqu'à 8 vCPU pour une charge de transcodage réelle — augmentez-la ici pour une utilisation en production, c'est la bonne variante pour cela. |
| `memory_limit` | `2Gi` | Valeur par défaut conservatrice. La FAQ de PeerTube recommande jusqu'à 8 Gi pour une charge de transcodage réelle. |
| `container_port` | `9000` | Valeur par défaut native `PEERTUBE_LISTEN_PORT` de PeerTube. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | `0` active la mise à l'échelle à zéro au minimum ; `3` est le plafond de coût HPA. |
| `enable_cloudsql_volume` | `true` | Exécute le sidecar Cloud SQL Auth Proxy ; App_GKE préfère sa boucle de rappel `127.0.0.1` pour `PEERTUBE_DB_HOSTNAME`, donc la valeur par défaut `PEERTUBE_DB_SSL="false"` de PeerTube est correcte sans modification (voir §1). |
| `enable_image_mirroring` | `true` | Miroir de l'image de base dans Artifact Registry. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Requis pour la fédération publique par défaut ; définissez `ClusterIP` sous une contrainte de quota d'IP statique et vérifiez via `kubectl port-forward` (utilisé pour la propre vérification en direct de ce module). |
| `session_affinity` | `ClientIP` | Sessions persistantes. |
| `workload_type` | `Deployment` | `StatefulSet` est disponible via `stateful_pvc_enabled`. |

### Groupe 5 — Variables d'environnement, secrets et SMTP {#group-5--environment-variables-secrets--smtp}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair fusionnées dans les valeurs par défaut de `PeerTube_Common`. |
| `secret_environment_variables` | `{}` | Références Secret Manager destinées à l'opérateur. |
| `smtp_host` | `""` | Nom d'hôte SMTP. Vide désactive l'e-mail ; une valeur non vide provisionne le secret du mot de passe SMTP. |
| `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | `587` / `""` / `""` / `false` / `""` | Configuration SMTP standard, utilisée uniquement lorsque `smtp_host` est défini. `mail_from` prend par défaut la valeur `noreply@<host>` lorsqu'il est vide. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne la VM NFS partagée, dont l'IP est utilisée comme hôte Redis par défaut lorsque `redis_host` est vide. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | `PeerTube_Common` fournit les déclarations de bucket `data`/`videos` réelles, remplaçant la valeur par défaut générique `data` de cette variable. |
| `gcs_volumes` | `[]` | Montages de volume GCS FUSE supplémentaires au-delà de `data` (qui contient déjà le correctif uid=999/gid=999 — voir §3). |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PeerTube nécessite PostgreSQL. |
| `db_name` | `peertube` | La base de données réellement créée et injectée en tant que `PEERTUBE_DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `peertube` | Le rôle réellement créé et injecté en tant que `PEERTUBE_DB_USERNAME` ; mot de passe auto-généré dans Secret Manager. |
| `enable_postgres_extensions` | `true` | Installe `postgres_extensions` après le provisionnement. |
| `postgres_extensions` | `["pg_trgm", "unaccent"]` | Requis par le guide d'installation de PeerTube ; non créé par PeerTube lui-même. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — ne jamais désactiver. PeerTube n'a pas de repli en mémoire pour BullMQ. Une précondition au moment du plan bloque `enable_redis=true` sans `redis_host` et sans `enable_nfs`. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS par défaut. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré fourni par `PeerTube_Common`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Lorsque `true`, App_GKE monte un véritable PVC de bloc à `/data` au lieu de GCS FUSE, et le propre câblage de `PeerTube_GKE` (`peertube.tf`) désactive automatiquement le volume GCS FUSE pour éviter un double montage. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 9000 | Confirme que le port est lié ; les propres migrations DB/Redis de PeerTube et l'amorçage de l'administrateur se terminent avant que l'API HTTP ne soit réellement prête. |
| `liveness_probe` | HTTP `/api/v1/config`, délai initial de 60s | Le point de terminaison de configuration public et non authentifié. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Vérification de la disponibilité de Cloud Monitoring — n'a de sens que lorsque `service_type = "LoadBalancer"` ou un domaine personnalisé est configuré. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` / `namespace` | Nom et espace de noms du service Kubernetes. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP interne ; IP externe du LoadBalancer (si réservée). |
| `service_url` | URL pour atteindre PeerTube. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | `127.0.0.1` via le sidecar / port du proxy d'authentification Cloud SQL. |
| `storage_buckets` | Buckets Cloud Storage créés (`data`, `videos`). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` | État de la surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` | Identifiant du projet. |
| `cicd_enabled` / `artifact_registry_repository` | État CI/CD et dépôt Artifact Registry. |
| `kubernetes_ready` | Si la charge de travail a atteint l'état Prêt. |
| `vpc_sc_enabled` / `audit_logging_enabled` | État VPC-SC et journalisation d'audit. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `/data` GCS FUSE `mount_options` | Laisser le correctif `PeerTube_Common`'s `uid=999`/`gid=999` en place | **Critique** | Sans cela, le pod boucle en crash avec `Error: EACCES: permission denied, mkdir '/data/logs'` à chaque redémarrage — un mode de défaillance propre à GKE non observé sur Cloud Run (voir §3). |
| `host` (`PEERTUBE_WEBSERVER_HOSTNAME`) | Définir votre vrai domaine avant la première utilisation réelle | Critique | Intégré à chaque URI d'acteur/objet ActivityPub au moment de la création ; le modifier après l'existence de comptes/vidéos réels rompt la fédération pour tout ce qui a été créé sous l'ancienne valeur. |
| `enable_redis` | `true` (ne jamais désactiver) | Critique | PeerTube n'a pas de solution de repli en mémoire pour BullMQ — le transcodage, la livraison de fédération et les notifications cessent tous de fonctionner sans Redis. |
| `videos` bucket `public_access_prevention` | `"inherited"` (défini par `PeerTube_Common`, ne pas remplacer par `"enforced"`) | Critique | L'architecture de PeerTube exige que les navigateurs récupèrent les fichiers vidéo directement depuis le stockage d d'objets ; `"enforced"` bloque l'octroi `allUsers:objectViewer` requis avec une erreur `412` au moment de l'apply. |
| `database_type` | `POSTGRES_15` | Critique | PeerTube nécessite PostgreSQL ; les extensions `pg_trgm`/`unaccent` et le schéma Sequelize sont spécifiques à Postgres. |
| `startup_probe` | Laisser `type = "TCP"` | Élevé | Les migrations DB/Redis de PeerTube et le démarrage de l'administrateur prennent plus de temps qu'une fenêtre de disponibilité HTTP typique ne le permet ; une sonde HTTP contre une API pas encore prête peut empêcher le pod de devenir Prêt. |
| `cpu_limit` / `memory_limit` | Augmenter substantiellement pour une charge de transcodage réelle | Élevé | Les valeurs par défaut `2000m`/`2Gi` sont délibérément conservatrices pour une utilisation démo/VOD ; la FAQ de PeerTube recommande jusqu'à 8 vCPU/8Gi pour un transcodage de production réel — des ressources sous-dimensionnées bloquent ou échouent les jobs de transcodage. |
| `stateful_pvc_enabled` | Laisser `false` sauf si vous avez besoin de garanties de verrouillage en écriture de stockage par blocs pour `/data` | Moyen | L'activation de cette option fait passer `/data` à un vrai PVC et désactive automatiquement le volume GCS FUSE — mélanger les deux monterait le chemin deux fois. |
| `service_type` | `LoadBalancer` pour la fédération publique ; `ClusterIP` uniquement sous une contrainte réelle de quota IP | Moyen | `ClusterIP` rend l'instance inaccessible depuis l'extérieur du cluster — bien pour la vérification `kubectl port-forward`, faux pour une instance fédérée de production. |
| `enable_open_registration` | `false` pour la plupart des déploiements | Moyen | Laisser l'inscription ouverte sur une instance publique permet à quiconque ayant l'URL de créer un compte et de télécharger du contenu vidéo. |
| `enable_iap` | `false` pour une instance publique | Moyen | IAP bloque le trafic de fédération ActivityPub non authentifié et la visualisation publique de vidéos — ne convient que pour une instance entièrement privée/de test. |
| `PT_INITIAL_ROOT_PASSWORD` secret | Récupérer et stocker en toute sécurité après le premier déploiement | Moyen | C'est la seule information d'identification pour le compte administrateur `root` ; elle n'est pas régénérée ou réappliquée après l'existence du compte. |

---

Pour le comportement de base référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à PeerTube partagée avec la variante
Cloud Run est définie dans **[PeerTube_Common](PeerTube_Common.md)** (source du
module : `modules/PeerTube_Common`). Voir aussi le guide de la variante Cloud Run,
**[PeerTube_CloudRun](PeerTube_CloudRun.md)**, pour l'histoire de l'accès public
aux buckets de stockage partagée par les deux plateformes.

## Guides associés {#related-guides}

- [Lab pratique : PeerTube sur GKE Autopilot](../labs/PeerTube_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [PeerTube Common — Configuration d'application partagée](PeerTube_Common.md) — la configuration partagée par les deux cibles de déploiement.
