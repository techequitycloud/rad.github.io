---
title: "Passbolt sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Passbolt sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Passbolt_GKE.md @ e69407af sha256:76c204ec7266 -->

# Passbolt sur GKE Autopilot {#passbolt-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Passbolt_GKE.png" alt="Passbolt sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Passbolt (Community Edition) est un gestionnaire de mots de passe gratuit,
open source et orienté équipe, avec chiffrement basé sur GPG et partage de
crédentiels par utilisateur/groupe — sous licence AGPL-3.0, ~6k étoiles GitHub.
Il occupe une niche différente de celle du module `Vaultwarden` de ce catalogue :
Vaultwarden est un coffre-fort personnel/compatible Bitwarden, tandis que
Passbolt est construit autour du partage de crédentiels chiffrés par GPG à
l'échelle de l'organisation entre utilisateurs et groupes. Ce module déploie
l'image officielle `passbolt/passbolt` sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Passbolt et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## Ce que coûte Passbolt sur RAD, et comparaison {#what-passbolt-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, le module GKE Autopilot de Passbolt sur RAD
coûte environ 110 US$ par mois sans licence par utilisateur.** GKE convient à
un Passbolt qui doit rester opérationnel, s'adapter à travers les pods, ou
fonctionner aux côtés d'autres charges de travail Kubernetes. Pour le coût le
plus bas, le [module Cloud Run](Passbolt_CloudRun.md) exécute le même Passbolt
pour environ 84 US$ par mois. Les chiffres sont à jour au 8 octobre 2026 ; les
sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une
certification, une démo, une activité saisonnière — un projet géré par RAD peut
être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que
ces 110 US$ deviennent quelques dollars par mois. Voir **Mettre en pause
gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **99 crédits par jour**, soit environ 2 970 crédits par mois (environ 297 US$ au prix de la recharge, 238 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de
fichiers et le réseau sont partagés par toutes les applications du projet, de
sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 110 US$**, ou environ 183 US$ sans le niveau gratuit |

- Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot
  ou zonal par compte de facturation, il ne s'applique donc que si c'est votre
  seul cluster de ce type. Cloud SQL coûte le même prix en africa-south1
  (Johannesburg) ; le pod et la VM coûtent environ 10 % de plus là-bas.
- **GKE Autopilot ne s'adapte pas à zéro.** Au moins un pod Passbolt est
  toujours en cours d'exécution, donc le coût ci-dessus est le même, que
  quelqu'un l'utilise ou non ; des pods supplémentaires ne sont ajoutés que
  sous charge.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut
  une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio,
  ce qui coûte environ 164 US$ par mois à elle seule.

### Comparaison {#how-it-compares}

- **Passbolt vend sa propre édition Pro** sous forme de licence auto-hébergée :
  **4,90 US$ par utilisateur et par mois, facturé annuellement, avec un minimum
  de 10 utilisateurs** (passbolt.com/pricing, 8 octobre 2026) — environ 49
  US$/mois pour une équipe de 10 personnes. Il s'agit de frais de licence en
  plus de l'hébergement, ajoutant le SSO, le provisionnement LDAP et la gestion
  des tags à l'édition communautaire gratuite que RAD déploie — ce n'est pas
  une alternative hébergée aux chiffres RAD ci-dessus.
- Un VPS nu exécutant l'édition communautaire gratuite — Hetzner CPX22 ou un
  Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 US$/mois — est moins
  cher que le chiffre de RAD pour votre propre projet ci-dessus, au prix de
  l'exécution de MySQL, des sauvegardes et de la gestion des clés GPG par
  vous-même. Passbolt n'a besoin que de 1 vCPU / 2 Gio, donc un niveau de VPS
  plus petit/moins cher ferait probablement l'affaire.
- Pour un gestionnaire de mots de passe en particulier, la question de savoir
  qui peut lire les sauvegardes est aussi importante que le prix : RAD conserve
  la base de données et les secrets dans Cloud SQL et Secret Manager plutôt que
  sur un serveur que vous administrez à la main.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Passbolt s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
tout le projet et le restaurer dans les 30 jours pour presque rien.** Cela
convient bien mieux à une utilisation occasionnelle — préparation à une
certification, environnement de démonstration, activité saisonnière — que
l'exécution continue de Passbolt.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie
  d'abord sa facturation, puis demande à Google de supprimer le projet. Google
  ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà dissociée, rien n'est facturé
  pendant cette période d'attente. Contrairement à la suppression d'un module,
  cela ne détruit pas Cloud SQL, une VM ou le cluster GKE un par un — tout le
  projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.**
  Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Cela coûte une poignée de crédits (moins de 1 US$) pour une chaîne
  typique de 2 à 3 déploiements, contre les 115 crédits (11,50 US$) que coûte
  un redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 110 US$.** Déployez Passbolt, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé.
  Vous ne payez les frais de module qu'une seule fois, les builds, et le temps
  pendant lequel Passbolt a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un
  projet que vous apportez et dont RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du
  niveau (100 crédits pour le niveau sandbox que la plupart des utilisations
  d'étude et de démo conviennent). Google indique que la plupart des services
  sont de nouveau pleinement fonctionnels dans les 36 heures suivant une
  restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes de Passbolt sont écrites dans un bucket à l'intérieur du projet,
  et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez apporté des modifications à Passbolt que vous souhaitez conserver,
  copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet)
  avant de supprimer, comme pour le flux de travail de redéploiement
  ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela
  n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE Autopilot ne s'adapte pas à zéro entre les requêtes. L'option ci-dessus ne
s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une
fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 115 crédits (11,50 US$), car RAD recrée le projet et les
  services partagés avant Passbolt. La suppression ne permet d'économiser de
  l'argent que si Passbolt devait rester inutilisé pendant environ 4 jours ou
  plus, à la fois dans votre propre projet (environ 3,67 US$ par jour) et dans
  un projet géré par RAD (99 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données
  et la VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien
  d'autre dans le projet ne les utilise, donc la suppression de Passbolt
  lorsque quelque chose d'autre partage le projet n'économise que la partie
  calcul de Passbolt.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un
  bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc
  copiez la dernière sauvegarde avant de la supprimer si vous voulez la
  conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à
  nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre
  projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin de
  la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour
les propres frais de RAD et les estimations de crédits quotidiens ; [Supprimer
et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle ; [Tarifs Passbolt](https://www.passbolt.com/pricing).

---

## 1. Vue d'ensemble {#1-overview}

Passbolt s'exécute comme un seul pod Apache/PHP sur GKE Autopilot. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Apache/PHP, port `80`, 1 vCPU / 2 Gio par défaut, `min_instance_count = 1`, `max_instance_count = 1` |
| Base de données | Cloud SQL pour MySQL (`MYSQL_8_0`) | Requis — Passbolt est une application CakePHP uniquement MySQL ; variables d'environnement `DATASOURCES_DEFAULT_*` discrètes, pas un seul DSN |
| État cryptographique | Deux volumes GCS-Fuse dédiés (`storage`, `jwt`) | Contiennent la paire de clés GPG du serveur et la paire de clés JWT auto-générées par le fournisseur — **pas** des secrets générés par Terraform |
| Secrets | Secret Manager | Seul le mot de passe de la base de données est généré par la fondation — Passbolt lui-même ne contribue à aucun secret (la sortie `Passbolt_Common` de `secret_ids` est toujours vide) |
| Ingress | Cloud Load Balancing | Service External LoadBalancer par défaut, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL est obligatoire.** `database_type` se résout en `MYSQL_8_0` (fixé
  par `Passbolt_Common`) ; Passbolt est construit sur CakePHP avec un schéma
  uniquement MySQL.
- **Pas de secret d'application côté serveur.** Contrairement à WordPress
  (plusieurs sels) ou aux applications de la famille Laravel (`APP_KEY`),
  Passbolt n'a aucune clé de chiffrement générée par Terraform. Son modèle de
  sécurité est entièrement côté client : l'extension de navigateur génère une
  paire de clés GPG et un mot de passe maître localement lors de la
  configuration. La propre paire de clés GPG du serveur (pour chiffrer les
  données *vers* Passbolt) et sa paire de clés JWT (jetons d'authentification
  API) sont toutes deux auto-générées par le point d'entrée du fournisseur au
  premier démarrage et persistées sur des volumes GCS-Fuse dédiés — non créées
  ou renouvelées par Terraform.
- **Deux volumes GCS-Fuse spécialement conçus, pas un seul, et pas tout le
  répertoire `/etc/passbolt`.** `storage` se monte étroitement à
  `/etc/passbolt/gpg` ; `jwt` se monte étroitement à `/etc/passbolt/jwt`. Le
  montage d'un seul volume sur tout `/etc/passbolt` masquerait les fichiers de
  configuration/PHP intégrés (`app.php`, `bootstrap.php`,
  `routes.php`) qui résident directement dans ce répertoire de l'image — la
  même classe de bug que ce catalogue a déjà rencontrée avec Cloudreve.
- **Options de montage GCS Fuse définissant explicitement `uid=33`/`gid=33`
  — un véritable correctif de bug spécifique à GKE, pas une valeur par défaut
  défensive.** Même si le processus de conteneur de niveau supérieur de
  l'image `passbolt/passbolt` s'exécute en tant que root, la fonction
  `gpg_gen_key()` du point d'entrée du fournisseur effectue en fait l'étape
  d'exportation de clé en tant que `su ... www-data` (uid=33/gid=33). Le pilote CSI
  GCS Fuse de GKE — contrairement à l'intégration gcsfuse de Cloud Run — ne
  définit pas par défaut un montage inscriptible pour un UID non root, de sorte
  que les deux volumes définissent explicitement `uid=33`/`gid=33`
  (plus `file-mode=0664`/`dir-mode=0775`) pour éviter `EACCES` au premier
  démarrage. Cela a été trouvé et corrigé en direct : la même *classe* de bug
  qu'une application Node uid-1000 a rencontrée ailleurs dans ce catalogue le
  même jour — toujours vérifier l'UID d'exécution réel de tout processus qui
  écrit sur un chemin monté par GCS-Fuse, pas seulement le `USER`
  déclaré de l'image.
- **`HTTPS = "on"` est toujours injecté.** Le `bootstrap.php` de Passbolt a
  `$trustProxy = false` codé en dur, il n'honore donc pas `X-Forwarded-Proto` par
  défaut — mais il vérifie directement la valeur littérale `env('HTTPS')`.
  Étant donné que le LoadBalancer GKE termine TLS en périphérie et transmet du
  HTTP simple au pod, cette surcharge statique permet à Passbolt de générer
  correctement les URL `https://` dans les e-mails et les liens absolus.
- **`enable_cloudsql_volume` est par défaut `true` ici** — correspondant au
  propre défaut de `Passbolt_Common`, et l'opposé de `Passbolt_CloudRun`, dont
  la variable de niveau supérieur par défaut `false`.
- **Pas d'assistant de configuration web à la première visite.** Le seul moyen
  pour qu'un compte administrateur existe est via le job d'initialisation
  `admin-bootstrap`, qui imprime une URL de configuration unique dans les logs de
  son pod (affichée dans Cloud Logging) que l'opérateur doit ouvrir dans une
  extension de navigateur compatible Passbolt.
- **Pas de Redis.** `enable_redis = false` par défaut — Passbolt n'a pas
  d'intégration Redis utilisée par ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de
noms et les autres identifiants sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Passbolt {#a-gke-autopilot--the-passbolt-workload}

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Passbolt pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot et du type de charge de
travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour MySQL {#b-cloud-sql-for-mysql}

Passbolt stocke toutes les données d'application — utilisateurs, groupes,
dossiers, ressources de mots de passe chiffrées, permissions de partage — dans
une instance MySQL 8.0 gérée de Cloud SQL. Les pods l'atteignent via le
sidecar **Cloud SQL Auth Proxy** sur une connexion TCP en boucle locale
(`127.0.0.1`) par défaut (`enable_cloudsql_volume =
true`). La connexion utilise les
propres noms de variables d'environnement discrètes de Passbolt
(`DATASOURCES_DEFAULT_HOST`/`_USERNAME`/`_PASSWORD`/`_DATABASE`,
confirmés par rapport au propre `/passbolt/env.sh` du fournisseur), aliasés à
partir des valeurs `DB_*` standard de la Fondation par le module
d'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Cloud Storage — les volumes de paires de clés GPG et JWT {#c-cloud-storage--the-gpg-and-jwt-keypair-volumes}

Deux buckets GCS sont provisionnés par `Passbolt_Common` et montés via le pilote
CSI GCS Fuse : `storage` à `/etc/passbolt/gpg`, `jwt` à
`/etc/passbolt/jwt`, tous deux avec des options de montage explicites
`uid=33`/`gid=33` (voir Vue d'ensemble). Ceux-ci contiennent la
paire de clés GPG du serveur et la paire de clés JWT auto-générées par le
fournisseur, toutes deux générées une fois au premier démarrage et réutilisées
à chaque démarrage ultérieur. La perte de l'un ou l'autre bucket invalide
chaque crédentiel que Passbolt a chiffré côté serveur et chaque session JWT
émise.

- **Console :** Cloud Storage → trouvez les deux buckets (les noms incluent les
  suffixes `storage` et `jwt`).
- **CLI :**
  ```bash
  gsutil ls -p "$PROJECT" | grep passbolt
  gsutil ls gs://<storage-bucket-name>/    # expect serverkey.asc, serverkey_private.asc
  ```

### D. Secret Manager {#d-secret-manager}

Passbolt lui-même ne contribue à aucun secret — la seule entrée Secret Manager
liée à ce déploiement est le mot de passe de la base de données, géré par la
Fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~passbolt"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat
géré par Google peut être activé, et une adresse IP statique est réservée par
défaut (`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging — y compris la sortie de
l'URL de configuration unique du job d'initialisation `admin-bootstrap`. Les
métriques GKE et Cloud SQL s'écoulent vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Passbolt {#3-passbolt-application-behaviour}

- **La chaîne de jobs d'initialisation en 2 étapes, et pourquoi le second job
  est réellement non trivial.** `Passbolt_Common` définit deux jobs Kubernetes
  ordonnés, tous deux avec `execute_on_apply = true` :
  1. **`db-init`** (`mysql:8.0-debian`) — crée le rôle et la base de
     données MySQL (le `db-init.sh` partagé à l'échelle du catalogue,
     `caching_sha2_password`-safe).
  2. **`admin-bootstrap`** (`passbolt/passbolt:<version>`, `depends_on_jobs = ["db-init"]`, monte
     les volumes `storage` et `jwt`) — enregistre le
     compte administrateur initial.

     Les jobs Kubernetes invoquent directement le `command`/`args`
     d'un conteneur, contournant entièrement la propre chaîne
     `/docker-entrypoint.sh` du fournisseur — ainsi un `cake passbolt register_user` nu sur un
     conteneur fraîchement provisionné échoue avec une erreur interne 500, car
     la paire de clés GPG du serveur (normalement générée pendant la propre
     séquence de démarrage du point d'entrée du fournisseur) n'existe pas
     encore, et le schéma n'a pas non plus été installé. Le job source
     plutôt les propres fonctions de point d'entrée du fournisseur
     (`/passbolt/entrypoint.sh`, `/passbolt/env.sh`, `/passbolt/deprecated_paths.sh`),
     génère/importe la paire de clés GPG du serveur si elle est manquante,
     génère un certificat SSL auto-signé si manquant, exécute la propre
     fonction `install()` du fournisseur (qui gère également la génération
     de la paire de clés JWT et l'installation/migration du schéma de la base
     de données), et seulement ensuite exécute `cake passbolt register_user -u <admin_email> -f <admin_first_name>
     -l <admin_last_name> -r admin` — **sans** le
     drapeau `-q`/quiet, de sorte que l'URL de configuration unique
     est imprimée et atterrit dans les logs du pod du job. Confirmé par
     rapport à la source réelle du fournisseur `/passbolt/entrypoint.sh`. Idempotent :
     `gpg_gen_key`/`install()` ne fait rien une fois que les clés et le
     schéma existent déjà à partir d'une exécution précédente.

  Sur GKE, `execute_on_apply = false` (si jamais défini sur un job personnalisé) ne ferait
  que empêcher Terraform d'**attendre** le job — le Job/pod Kubernetes
  sous-jacent est toujours créé et planifié immédiatement dans les deux cas.
  La correction de l'ordre `db-init` → `admin-bootstrap` ici repose sur
  `depends_on_jobs` (le système de dépendance des jobs d'App_GKE), et non sur
  un séquençage au moment de l'apply.

- **Pas d'assistant de configuration à la première visite, et un modèle de
  bootstrap réellement différent de la plupart des applications de ce
  catalogue.** Passbolt exige que le client (une extension de navigateur)
  génère sa propre paire de clés GPG et son mot de passe maître — il n'y a pas
  de mot de passe côté serveur à initialiser et rien à récupérer de Secret
  Manager. Récupérez plutôt l'URL de configuration unique :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<admin-bootstrap-job-name> | grep '/setup/start/'
  ```

- **Point de terminaison de santé.** `GET /healthcheck/status.json` renvoie un
  `200` non authentifié avec `{"header":{"status":"success",...},"body":"OK"}` une fois prêt —
  confirmé par des tests de conteneur locaux et un déploiement en direct. Les
  sondes `startup_probe`/`liveness_probe` au niveau du conteneur ciblent toutes
  deux ce chemin par défaut.

- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Passbolt sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par exemple `gke`) de tout `Passbolt_CloudRun` (`cr`) co-déployé pour éviter une collision de noms. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `passbolt` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Passbolt` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag d'image `passbolt/passbolt`. |
| `admin_email` | `admin@example.com` | E-mail pour le compte administrateur enregistré par `admin-bootstrap`. |
| `admin_first_name` / `admin_last_name` | `Admin` / `User` | Champs de nom pour le compte administrateur initial. |
| `enable_gcs_storage_volume` | `true` | Monte les volumes GCS-Fuse `storage` (GPG) et `jwt`. Garder activé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie l'image officielle directement ; Passbolt ne prend en charge que l'image pré-construite. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `2Gi` | Limite de mémoire — PHP 8.x + Apache. |
| `container_port` | `80` | Passbolt (Apache) écoute ici. |
| `min_instance_count` | `1` | Réplicas de pods minimum. |
| `max_instance_count` | `1` | Réplicas de pods maximum. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. L'alias `DATASOURCES_DEFAULT_HOST` de Passbolt se résout à l'adresse de bouclage du sidecar lorsqu'il est activé. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Passbolt dans Artifact Registry. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (se résout en `Deployment`) | `"Deployment"` ou `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Affinité de session pour le service Kubernetes. |
| `namespace_name` | `""` (auto-généré) | Espace de noms Kubernetes. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un volume Filestore. **Non utilisé par le propre modèle de persistance de Passbolt** — les paires de clés GPG/JWT résident sur des volumes GCS-Fuse dédiés et tout le reste est dans MySQL. Valeur par défaut générique inoffensive. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires à monter via le pilote CSI GCS Fuse, en plus des deux provisions automatiques de Passbolt (`storage`, `jwt`). |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` (se résout en `MYSQL_8_0`) | Moteur Cloud SQL. Passbolt nécessite MySQL. |
| `application_database_name` | `passbolt` | Nom de la base de données MySQL. |
| `application_database_user` | `passbolt` | Utilisateur de l'application MySQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour la chaîne de 2 jobs par défaut de `Passbolt_Common` (`db-init` → `admin-bootstrap`). Une liste non vide la remplace entièrement. |
| `cron_jobs` | `[]` | Passbolt n'a pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthcheck/status.json` | Sondes au niveau du conteneur, passées via `Passbolt_Common`. |
| `startup_probe_config` / `health_check_config` | Sondes au niveau du LoadBalancer de la Fondation | Chemin `"/"` par défaut — distinct des sondes au niveau du conteneur ci-dessus. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Passbolt. Présent pour la compatibilité de la plateforme. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés. |
| `reserve_static_ip` | `true` | Réserver une IP statique globale stable — recommandé pour que l'adresse du service ne change pas lors des redéploiements. |

Toutes les autres entrées (Métadonnées du module, Variables d'environnement et
secrets, Intégration CI/CD et GitHub, SQL personnalisé, IAP et Cloud Armor,
Configuration StatefulSet, Contrôles de service VPC, Politiques de fiabilité)
sont héritées de `App_GKE` avec leur comportement standard — voir
[App_GKE](App_GKE.md) pour la liste complète, organisée par groupe.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP intra-cluster / IP externe du LoadBalancer. |
| `service_url` | URL pour atteindre Passbolt. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le sidecar Auth Proxy) / port. |
| `storage_buckets` | Les buckets GCS `storage` (GPG) et `jwt`. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `admin-bootstrap`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources de la charge de travail sont déployées. `false` lors de la première application d'un nouveau cluster inline — une nouvelle exécution complète le déploiement. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation au moment du plan héritée.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs et les combinaisons au moment du plan. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la
> création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | se résout en `MYSQL_8_0` | Critique | Le schéma CakePHP de Passbolt est uniquement MySQL — tout autre moteur interrompt complètement le démarrage. |
| `enable_gcs_storage_volume` | `true` | Critique | La désactivation entraîne la perte des volumes persistants pour la paire de clés GPG du serveur et la paire de clés JWT auto-générées — chaque crédentiel chiffré côté serveur par Passbolt, et chaque session JWT émise, devient irrécupérable au prochain redémarrage du pod. |
| Options de montage GCS Fuse `uid=33`/`gid=33` | Déjà définies dans `Passbolt_Common` — ne pas supprimer si vous personnalisez `gcs_volumes` | Critique | Sans elles, `www-data` (l'uid sous lequel l'étape de génération de clé du point d'entrée du fournisseur s'exécute réellement) obtient `EACCES: permission denied` lors de l'écriture des fichiers de clés GPG/JWT au premier démarrage, et le pod ne devient jamais réellement utilisable même s'il signale Ready. |
| Ordre `initialization_jobs` (`db-init` → `admin-bootstrap`) | Laisser `[]` sauf si vous comprenez parfaitement la dépendance | Critique | La réplication par le job `admin-bootstrap` de la séquence de génération de clés GPG/installation de schéma du fournisseur est essentielle — un job de remplacement naïf qui exécute simplement `cake passbolt register_user` directement échoue avec une erreur interne car la paire de clés GPG du serveur et le schéma n'existent pas encore. Sur GKE, `execute_on_apply=false` NE retarde PAS la planification du pod — seulement l'attente de Terraform — donc la garantie d'ordre vient entièrement de `depends_on_jobs`. |
| `enable_cloudsql_volume` | `true` (valeur par défaut de cette variante) | Élevé | Le sidecar Auth Proxy est le chemin de connectivité MySQL prévu sur GKE. |
| `reserve_static_ip` | `true` | Moyen | Sans IP statique réservée, l'adresse externe du LoadBalancer peut changer lors des redéploiements, rompant toute URL mise en signet ou enregistrement DNS qui y pointe. |
| `admin_email` / `admin_first_name` / `admin_last_name` | Définir intentionnellement avant le premier déploiement | Moyen | Ceux-ci initialisent le seul et unique compte administrateur créé par le job `admin-bootstrap` ; il n'y a aucun moyen intégré à l'application de les modifier après coup, sauf via l'interface utilisateur d'administration de Passbolt une fois connecté. |
| Pas de mot de passe administrateur à perdre | — | — | Contrairement à la plupart des applications de ce catalogue, il n'y a pas de crédentiel administrateur détenu par Secret Manager à récupérer. Si l'URL de configuration unique est manquée et expire, la solution consiste à réexécuter le job `admin-bootstrap` (idempotent pour les étapes GPG/JWT/schéma ; consultez la documentation CLI de Passbolt pour réémettre un lien de configuration pour `register_user`). |

---

Pour le comportement de la fondation référencé tout au long — Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Passbolt
partagée avec la variante Cloud Run est décrite dans
**[Passbolt_Common](Passbolt_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Passbolt sur GKE Autopilot](../labs/Passbolt_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Passbolt Common — Configuration d'application partagée](Passbolt_Common.md) — la configuration partagée par les deux cibles de déploiement.
