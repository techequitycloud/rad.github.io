---
title: "Outline sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Outline sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Outline_GKE.md @ 1665a43e sha256:c5de8de32ae3 -->

# Outline sur GKE Autopilot {#outline-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Outline_GKE.png" alt="Outline sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Outline est une base de connaissances et un wiki d'équipe open source de style
Notion : documents Markdown collaboratifs en temps réel, recherche en texte
intégral puissante et collections de documents imbriquées, authentifiés
exclusivement via un fournisseur d'identité externe (OIDC, Google, Slack,
etc.) plutôt que par son propre magasin de noms d'utilisateur/mots de passe. Ce
module déploie Outline sur **GKE Autopilot** sur la base
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Outline utilise et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la base App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## Ce que coûte Outline sur RAD, et comment cela se compare {#what-outline-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, le module GKE Autopilot d'Outline sur RAD
coûte environ 110 $ US par mois, sans licence par utilisateur.** GKE convient à
un Outline qui doit rester opérationnel, s'adapter à plusieurs pods ou
fonctionner aux côtés d'autres charges de travail Kubernetes. Pour le coût le
plus bas, le [module Cloud Run](Outline_CloudRun.md) exécute le même Outline
pour environ 82 $ US par mois. Les chiffres sont valables au 8 octobre 2026 ;
les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une
certification, une démo, une activité saisonnière — un projet géré par RAD peut
être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que
ces 110 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause
gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **95 crédits par jour**, soit environ 2 850 crédits par mois (environ 285 $ US au prix de la recharge, 228 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de
fichiers et le réseau sont partagés par toutes les applications du projet, de
sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 2 Gio | 39,68 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 110 $ US**, ou environ 183 $ US sans le niveau gratuit |

- Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot
  ou zonal par compte de facturation, il ne s'applique donc que si c'est votre
  seul cluster de ce type. Cloud SQL coûte le même prix en africa-south1
  (Johannesburg) ; le pod et la VM coûtent environ 10 % de plus là-bas.
- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod Outline fonctionne
  toujours, donc le coût ci-dessus est le même que quelqu'un l'utilise ou non ;
  des pods supplémentaires ne sont ajoutés qu'en cas de charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise une petite
  VM NFS/cache par défaut. La plus petite instance de Filestore est de 1 Tio,
  ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- **Outline vend son propre plan Cloud hébergé.** Le plan Starter coûte
  **10 $ US/mois pour une équipe de 10 membres maximum**
  (getoutline.com/pricing, 8 octobre 2026), passant à 79 $ US/mois pour 11 à
  100 membres ; les deux plans incluent les mêmes fonctionnalités.
- Le chiffre du projet propre à RAD ci-dessus est plus élevé en termes
  monétaires car il s'agit d'une infrastructure dédiée, et non d'un service
  mutualisé partagé — une instance Cloud SQL dédiée, un serveur de fichiers NFS
  et un service Cloud Run, plutôt qu'une part du propre service d'Outline.
- Un VPS nu — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux
  environ 24 $ US/mois — est également moins cher que le chiffre du projet
  propre à RAD, au prix de l'exécution de PostgreSQL, Redis, des sauvegardes et
  des correctifs par vous-même. Outline n'a besoin que de 1 vCPU / 1-2 Gio,
  donc un niveau de VPS plus petit/moins cher que cela ferait probablement
  l'affaire.
- Outline Cloud est le moins cher des trois jusqu'à ce qu'une équipe dépasse
  10 membres ou ait besoin que les données restent dans son propre projet
  Google Cloud.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Outline s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à une utilisation occasionnelle — étudier pour une
certification, un environnement de démonstration, une activité saisonnière —
qu'à l'exécution continue d'Outline.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un seul module, cela ne
  détruit pas Cloud SQL, aucune VM ou le cluster GKE un par un — l'ensemble du
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas un rebuild.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google
  de récupérer le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout
  est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification, pas un
  rebuild, et une mise à jour ne facture plus jamais les frais de module. Cela
  coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à
  3 déploiements, contre les 180 crédits (18 $ US) qu'un redéploiement complet
  coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 110 $ US.** Déployez Outline, utilisez-le un certain temps, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez
  avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne
  payez que les frais de module une fois, les builds, et le temps pendant
  lequel Outline était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox qui convient à la plupart des utilisations
  d'étude et de démonstration). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes d'Outline sont écrites dans un bucket à l'intérieur du projet, et
  ce bucket n'est **pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez apporté des modifications à Outline que vous souhaitez conserver,
  copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet)
  avant de supprimer, comme pour le workflow de redéploiement ci-dessous. Pour
  une installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot ne s'adapte pas à zéro entre les requêtes. L'option ci-dessus ne
s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une
fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 180 crédits (18 $ US), car RAD recrée le projet et les
  services partagés avant Outline. La suppression ne permet d'économiser de
  l'argent que si Outline reste inutilisé pendant environ 5 jours ou plus,
  aussi bien dans votre propre projet (environ 3,67 $ US par jour) que dans un
  projet géré par RAD (95 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données
  et la VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien
  d'autre dans le projet ne les utilise, donc la suppression d'Outline alors
  que quelque chose d'autre partage le projet n'économise que la partie
  calcul d'Outline.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un
  bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc
  copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la
  conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à
  nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  diminue, la facturation est suspendue et les données sont conservées, de
  sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour
les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle ; [Tarification Outline](https://www.getoutline.com/pricing).

---

## 1. Vue d'ensemble {#1-overview}

Outline s'exécute comme une seule charge de travail Node.js avec une
dépendance Redis obligatoire (utilisée pour la collaboration en temps réel/la
coordination de session, pas seulement la mise en cache). Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js sur le port 3000, 1 vCPU / 2 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Outline (Sequelize) ne prend en charge que Postgres |
| Cache / coordination | Redis (autogéré, co-hébergé sur la VM NFS par défaut) | **Requis**, non optionnel — Outline en a besoin même en réplica unique |
| Persistance des fichiers | Cloud Filestore (NFS) | Les fichiers téléchargés persistent sous `/var/lib/outline/data`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Deux buckets provisionnés par défaut (`...-storage`, `...-data`) ; aucun n'est monté dans le pod tel quel |
| Secrets | Secret Manager | `SECRET_KEY` et `UTILS_SECRET` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée par défaut ; domaine personnalisé optionnel + certificat géré, IAP, Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est effectivement obligatoire** (`database_type` par défaut
  `POSTGRES_15`) — les migrations Sequelize d'Outline, l'extension de
  recherche `pg_trgm` et la logique de chaîne de connexion du point
  d'entrée supposent toutes Postgres.
- **Redis est requis, non optionnel.** `enable_redis = true` par défaut ; avec
  `enable_nfs = true` (également par défaut), la base pointe `REDIS_HOST` vers
  l'IP du serveur NFS, qui co-héberge Redis — pas besoin de Memorystore séparé.
- **Multi-réplica par défaut** (`min_instance_count = 1`, `max_instance_count = 3`) —
  contrairement à la plupart des applications basées sur NFS ici, Outline est
  conçu pour exécuter plusieurs réplicas simultanément (Redis coordonne
  l'état).
- **Les déploiements basés sur NFS utilisent toujours `Recreate`,**
  arrêtant **tous** les réplicas avant de démarrer le nouvel ensemble — avec
  `max_instance_count = 3`, c'est une brève panne complète à chaque redéploiement,
  pas un déploiement progressif.
- **Deux buckets Cloud Storage sont créés mais inutilisés par défaut** — un
  de `Outline_Common` (`storage`), un de la valeur par défaut de cette
  variante (`data`). Outline stocke en fait les téléchargements sur
  NFS (`FILE_STORAGE=local`) ; aucun bucket n'est monté via `gcs_volumes` sauf
  configuration.
- **`SECRET_KEY`/`UTILS_SECRET` sont auto-générés** dans Secret Manager et
  câblés à la fois comme références Secret Manager et comme `explicit_secret_values`
  bruts (une couverture de lecture après écriture ; le chemin Secret-Manager-ID
  l'emporte).
- **Un fournisseur d'authentification est requis avant que la connexion ne
  fonctionne.** Les variables `OIDC_*` sont vides ; Outline construit
  son `redirect_uri` OIDC à partir de `URL`, donc sans
  fournisseur configuré, il enregistre **zéro** méthodes
  d'authentification. Voir [Section 3](#3-outline-application-behaviour).
- **Le LoadBalancer par défaut est en HTTP simple**, ce qui bloque
  complètement les connexions OAuth tant qu'un domaine et TLS ne sont pas
  ajoutés — voir [Section 6](#6-configuration-pitfalls--sensible-defaults).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.
L'espace de noms et les autres identifiants sont rapportés dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Outline {#a-gke-autopilot--the-outline-workload}

Les pods Outline sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que les pods demandent réellement. Parce que `enable_nfs = true`, le déploiement
utilise la stratégie `Recreate` — avec `max_instance_count > 1`, cela
signifie que chaque déploiement arrête tous les réplicas avant de démarrer
l'ensemble de remplacement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Outline pour les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app~outline
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Outline stocke tous les documents, collections, utilisateurs et index de
recherche dans une instance Cloud SQL pour PostgreSQL 15 gérée, accessible via
le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` (`enable_cloudsql_volume
= true`) ;
aucune IP publique n'est exposée. Lors du premier déploiement, le job
`db-init` crée la base de données/l'utilisateur/les autorisations ; le
point d'entrée personnalisé exécute les migrations Sequelize d'Outline à
chaque démarrage de conteneur (idempotent).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Redis {#c-redis}

La couche de collaboration/session et la limitation du taux d'API d'Outline
nécessitent Redis — ce n'est pas un niveau de cache optionnel comme pour de
nombreuses applications. Par défaut, la base pointe `REDIS_HOST` vers l'IP
interne de la VM du serveur NFS (elle co-héberge un processus Redis) ;
définissez `redis_host` pour utiliser Memorystore à la place.

- **Console :** Compute Engine → Instances de VM (Redis auto-hébergé sur la VM
  NFS), ou Memorystore → Instances Redis si vous êtes passé à une instance
  gérée.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^REDIS_'
  gcloud redis instances list --project "$PROJECT" --region "$REGION"   # only if using Memorystore
  ```

Voir [App_GKE](App_GKE.md) pour la résolution de `enable_redis`/`redis_host`.

### D. Cloud Filestore (NFS) et Cloud Storage {#d-cloud-filestore-nfs--cloud-storage}

Les fichiers téléchargés d'Outline (`FILE_STORAGE=local`) résident sur **NFS
(Cloud Filestore)**, monté à `/var/lib/outline/data`, partagé entre tous les
pods. Deux buckets **Cloud Storage** (suffixes `storage` et
`data`) sont également provisionnés automatiquement — aucun n'est
monté dans le pod par défaut, car Outline est configuré pour le stockage
local/NFS plutôt que pour le stockage d'objets compatible S3.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~outline"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse
(`gcs_volumes`) si vous souhaitez connecter l'un des buckets provisionnés
en tant que volume monté.

### E. Secret Manager {#e-secret-manager}

Deux secrets spécifiques à Outline sont générés automatiquement et stockés
dans Secret Manager : `SECRET_KEY` (chiffre les cookies et les données
sensibles au repos) et `UTILS_SECRET` (authentification API/utilitaires
internes). Le mot de passe de la base de données est géré séparément par la
base. Sur GKE, les valeurs sauvegardées par Secret Manager sont matérialisées
dans le cluster en tant que secrets Kubernetes natifs par le contrôleur
**SecretSync** (le CRD `secretsyncs.secret-sync.gke.io`), que la base App_GKE attend
pendant le démarrage du cluster.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~outline"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"   # the SecretSync-materialised "<prefix>-secrets" object
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de SecretSync/CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`, `reserve_static_ip = true`, HTTP simple — pas de
terminateur TLS). Un domaine personnalisé avec un certificat géré par Google
peut être activé via `enable_custom_domain` + `application_domains`, ce qui est requis
pour que les connexions OAuth d'Outline fonctionnent (voir
[Section 6](#6-configuration-pitfalls--sensible-defaults)).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN, IAP,
Cloud Armor et les détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring.
`uptime_check_config` est désactivé par défaut pour ce module
(`enabled = false`) — activez-le une fois que l'application est accessible via
HTTPS.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Outline {#3-outline-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il
  se connecte à Cloud SQL via le sidecar Auth Proxy, crée de manière
  idempotente le rôle d'application et la base de données (appartenant à ce
  rôle), accorde les privilèges sur la base de données et le schéma
  `public`, puis signale au sidecar proxy de s'arrêter
  (`quitquitquit`) afin que le Job se termine. Peut être réexécuté
  (`execute_on_apply = true`) en toute sécurité.
- **Les migrations s'exécutent à chaque démarrage de conteneur, et non dans un
  job séparé.** Le `entrypoint.sh` personnalisé (intégré à l'image
  au moment du build) assemble `DATABASE_URL` à partir des valeurs
  `DB_*` injectées par la plateforme (en fonction de si
  `DB_HOST` est un chemin de socket, `127.0.0.1`, ou une IP
  privée), attend que Postgres accepte les connexions, exécute les migrations
  Sequelize d'Outline (`sequelize db:migrate --env=production-ssl-disabled`, idempotent), et
  seulement ensuite exécute le serveur Node.
- **`URL` doit résoudre l'adresse publique, sinon OIDC
  enregistre zéro fournisseurs.** Outline dérive son `redirect_uri` OIDC
  de `URL`. Contrairement à la variante Cloud Run (qui définit
  `service_url_env_var_name = "URL"` afin que la base injecte directement l'URL
  prédite), la variante GKE ne déclare **aucune** variable
  `service_url_env_var_name` — `App_GKE` injecte inconditionnellement l'URL
  calculée en tant que `GKE_SERVICE_URL`, et le point d'entrée applique
  `URL="${CLOUDRUN_SERVICE_URL:-${GKE_SERVICE_URL:-}}"` uniquement **si `URL` n'est pas déjà
  défini**. Ainsi, un nouveau déploiement remplit `URL`
  automatiquement à partir de l'IP du LoadBalancer externe (ou `https://<domain>`
  une fois `application_domains` défini) — aucune surcharge manuelle
  `URL` n'est nécessaire, sauf si l'on force un nom d'hôte avant le
  provisionnement DNS/certificat.
- **Espaces réservés OIDC — l'opérateur doit configurer après le
  déploiement.** `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URI`,
  `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI` sont vides (`OIDC_DISPLAY_NAME`/`OIDC_SCOPES`
  sont pré-remplis). Définissez-les via `environment_variables`, ou de préférence
  liez `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` comme `secret_environment_variables` (voir
  [Section 6](#6-configuration-pitfalls--sensible-defaults)). Enregistrez
  `<URL>/auth/oidc.callback` sur le **même hôte** que `URL`.
- **Sondes de santé.** Démarrage : **HTTP** `GET /`, délai initial de
  60 s, période de 10 s, seuil d'échec 6 (budget d'environ 120 s). Vivacité :
  **HTTP** `GET /`, délai initial de 60 s, période de 30 s, seuil
  d'échec 3 — le délai généreux couvre l'exécution de la migration au premier
  démarrage. `FORCE_HTTPS` est forcé à `"false"` par
  `Outline_Common` afin que ces sondes HTTP ne soient pas redirigées 301
  vers un `:443` sans écouteur derrière le LoadBalancer HTTP simple
  par défaut.
- **Contraintes de mise à l'échelle.** `min_instance_count = 1`, `max_instance_count =
  3` par
  défaut. Parce que `enable_nfs = true`, les déploiements utilisent la stratégie
  `Recreate` — tous les réplicas sont arrêtés avant le démarrage des
  nouveaux, attendez-vous donc à une courte panne complète à chaque
  redéploiement (pas un déploiement progressif, sans interruption).
- **Inspectez le job d'initialisation et la configuration en cours
  d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^(URL|OIDC_|REDIS_|DATABASE_URL)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (correspondant aux balises `{{UIMeta group=N}}` dans
`variables.tf`). Seuls les paramètres spécifiques ou notables pour
Outline sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `outline` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `outlinewiki/outline` utilisé comme base de build personnalisé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Le serveur Node.js d'Outline écoute sur le port 3000. |
| `container_resources.cpu_limit` / `.memory_limit` | `1000m` / `2Gi` | 1 vCPU / 2 Gio minimum recommandé. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Plafond par défaut plus élevé que la plupart des modules — Outline prend en charge le multi-réplica via la coordination Redis. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (bouclage `127.0.0.1:5432`) — requis sur GKE. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | (voir [Outline_Common](Outline_Common.md)) | Pré-rempli avec `PGSSLMODE`, `FORCE_HTTPS=false`, `FILE_STORAGE*`, et des espaces réservés `OIDC_*` vides ; **définissez le fournisseur d'authentification et, éventuellement, `URL` ici.** |
| `secret_environment_variables` | `{}` | Références Secret Manager injectées via SecretSync ; utilisez-les pour `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` au lieu du texte brut. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur d'Outline ; HTTP simple par défaut. |
| `workload_type` | `null` → `Deployment` | Déploiement, stratégie `Recreate` (basée sur NFS). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis pour que les fichiers téléchargés persistent et soient partagés entre les réplicas. |
| `nfs_mount_path` | `/var/lib/outline/data` | Doit correspondre à `FILE_STORAGE_LOCAL_ROOT_DIR` défini par `Outline_Common`. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Fusionné avec le bucket `Outline_Common` `storage` — deux buckets sont créés ; aucun n'est utilisé par l'application par défaut. |
| `gcs_volumes` | `[]` | Non renseigné par défaut ; Outline utilise NFS, pas GCS Fuse, pour les téléchargements. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis par Outline** — ne pas désactiver. |
| `redis_host` | `""` | Laissez vide pour utiliser le Redis co-hébergé sur la VM NFS ; définissez pour une instance Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement — les migrations d'Outline et l'extension `pg_trgm` supposent Postgres. |
| `application_database_name` | `outline` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `outline` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |
| `postgres_extensions` | `["pg_trgm"]` | Requis pour la recherche de documents en texte intégral d'Outline. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress ; nécessaire pour un TLS réel (non-nip.io). |
| `application_domains` | `[]` | Définir un vrai nom d'hôte ici (plus un certificat) est ce qui permet réellement à `service_url`/`URL` d'être sur `https://` — voir [Section 6](#6-configuration-pitfalls--sensible-defaults). |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à la phase. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Outline (également injectée dans le conteneur en tant que `GKE_SERVICE_URL`). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa
> configuration via le moteur de base [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment du plan — un `StatefulSet` forcé
> à côté d'un paramètre sans état, IAP sans identités autorisées,
> `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue au **plan** avec une erreur claire et nommée avant la
> création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Les migrations Sequelize d'Outline et l'extension de recherche `pg_trgm` supposent Postgres ; un moteur non-Postgres corrompt le schéma et la recherche. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline tous les documents. |
| `SECRET_KEY` (auto-généré) | Ne jamais modifier | Critique | Sa rotation invalide tous les cookies de session existants et toutes les données chiffrées au repos avec l'ancienne clé. |
| `URL` / `GKE_SERVICE_URL` auto-injecté | Laissé non défini (auto) ou explicitement l'URL publique réelle | Critique | S'il résout un hôte incorrect, l'OIDC `redirect_uri` d'Outline ne correspondra pas à ce qui est enregistré auprès de l'IdP, et/ou zéro fournisseur s'enregistrera — page de connexion inutilisable. |
| HTTPS devant le service | Configurer `enable_custom_domain` + `application_domains` + TLS avant d'activer l'authentification | Critique | Passport définit le cookie OAuth `state` `secure: true` ; sur le LoadBalancer L4 HTTP simple par défaut, `/auth/<provider>` renvoie `500 — Cannot send secure cookie over unencrypted connection`. La page d'accueil se charge correctement, masquant la cause réelle. |
| `enable_redis` | `true` | Critique | Outline nécessite Redis même avec un seul réplica ; le désactiver interrompt la coordination en temps réel/session et l'application ne fonctionnera pas correctement. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les fichiers téléchargés éphémères — perdus lors de la recréation du pod — et interrompt le partage entre les réplicas. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` déplacé de simple à secret | Définir uniquement dans `secret_environment_variables` ; supprimer de `environment_variables` dans la même application | Élevé | Ceux-ci sont livrés en tant que **variables d'environnement de chaîne vide simples**. Contrairement à l'impératif `gcloud run services update` de Cloud Run (qui nécessite une étape `--remove-env-vars` d'abord, avec l'erreur "déjà défini avec un type différent"), le commutateur de GKE est déclaratif — `tofu apply` rend la liste `env` souhaitée en une seule passe. Mais laisser la clé dans **les deux** cartes à la fois place **deux entrées `env` du même nom** dans la spécification du Pod (une `value`, une `valueFrom.secretKeyRef`) ; Kubernetes accepte cela, mais la valeur que le processus observe n'est pas vérifiée ici — supprimez la clé en texte brut lors de l'ajout de la clé basée sur un secret. {/* TODO: verify observed env precedence for a duplicate plain+secret env name on this cluster's container runtime */} |
| `max_instance_count` avec `enable_nfs = true` | Comprendre le compromis `Recreate` | Élevé | Chaque redéploiement arrête **tous** les réplicas en cours d'exécution (pas seulement un pod de pointe) avant de démarrer l'ensemble de remplacement — une brève panne complète à chaque mise à jour, pire que le cas de réplica unique dans la plupart des autres modules basés sur NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS, l'URI de redirection OIDC enregistré et `URL`. |
| `uptime_check_config.enabled` | `false` par défaut | Moyen | Pas d'alerte de panne automatique tant que vous ne l'activez pas — il est judicieux de le laisser désactivé tant que HTTPS/l'authentification ne sont pas configurés, car l'application est censée être inutilisable (en boucle de crash ou 500 à la connexion) jusque-là. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la base référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Outline
partagée avec la variante Cloud Run — les secrets auto-générés, les variables
d'environnement par défaut, `entrypoint.sh`/`Dockerfile` et le job
`db-init` — est décrite dans **[Outline_Common](Outline_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Outline sur GKE Autopilot](../labs/Outline_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Outline sur Google Cloud Run](Outline_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Outline Common — Configuration d'application partagée](Outline_Common.md) — la configuration partagée par les deux cibles de déploiement.
