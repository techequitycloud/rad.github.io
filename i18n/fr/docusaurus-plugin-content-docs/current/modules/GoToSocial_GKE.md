---
title: "GoToSocial sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de GoToSocial sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GoToSocial_GKE.md @ 1665a43e sha256:3984829251cd -->

# GoToSocial sur GKE Autopilot {#gotosocial-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoToSocial_GKE.png" alt="GoToSocial sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoToSocial est un serveur ActivityPub/Fediverse léger et auto-hébergé — une
petite alternative à Mastodon, écrit sous la forme d'un seul binaire Go statique. Ce
module déploie GoToSocial sur **GKE Autopilot** en s'appuyant sur la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par GoToSocial et sur la manière de les explorer
et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## Ce que coûte GoToSocial sur RAD, et comment cela se compare {#what-gotosocial-costs-on-rad-and-how-that-compares}

**L'exécution d'un pod GoToSocial sur GKE Autopilot dans votre propre projet Google Cloud coûte environ 136,37 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 110 crédits facturé une seule fois au moment du déploiement. L'exécution d'une instance Fediverse mono-utilisateur ou pour un petit groupe ne nécessite pas beaucoup de calcul — GoToSocial est un binaire Go statique — mais une véritable base de données Postgres derrière est non négociable pour que la fédération fonctionne de manière fiable. Dans un projet géré par RAD, les frais de module tombent à 99 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage d'un projet géré par RAD qu'un VPS auto-hébergé ne peut égaler — ou voir le [guide Cloud Run](GoToSocial_CloudRun.md) pour l'option à moindre coût.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 110 crédits | 99 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 136,37 $/mois, facturé par Google au prix catalogue | ~105 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 Gio | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **136,37 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est la seule, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Une comparaison auto-gérée dimensionnée aux 2 vCPU/4 Go de ce module : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go est le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois.
- Il existe des hébergeurs Fediverse commerciaux (masto.host et similaires), mais ils hébergent Mastodon, pas GoToSocial — il n'y a pas de SaaS hébergé officiel pour ce projet exact, donc une comparaison de prix avec l'un d'eux comparerait des logiciels différents.
- L'écart est le même que partout ailleurs sur cette liste : un VPS est moins cher en termes d'argent, mais c'est vous qui faites pivoter le mot de passe de la base de données, appliquez les mises à jour de sécurité et restaurez à partir de la sauvegarde si le disque se remplit.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien lorsqu'il est en pause.
La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'un module,
cela ne **détruit pas** Cloud SQL, aucune VM, ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà
déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement pour
confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve
les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez
le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.

Un véritable écart : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
personnalisé GoToSocial et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket
en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable,
cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet géré par RAD, il n'y a pas de pause gratuite —
la suppression supprime définitivement les ressources, et ramener GoToSocial signifie redéployer à partir de
zéro. Cela coûte environ 113-116 crédits (les frais de module de 110 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si GoToSocial devait rester inutilisé assez longtemps pour compenser ce
coût de redéploiement par rapport à son propre coût d'exécution — pour GoToSocial, c'est environ 3 jours ou
plus. La majeure partie de ce coût d'exécution est généralement la base de données (et, lorsque ce module en utilise une, la VM de serveur de fichiers partagé ou le cluster GKE) — ceux-ci ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui,
donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une classe. Chaque participant obtient l'
application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute l'application pour un client à partir d'un
portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est suspendue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le
partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

GoToSocial s'exécute comme une seule charge de travail binaire Go sur GKE Autopilot, déployée
directement à partir de l'image officielle `docker.io/superseriousbusiness/gotosocial`
— pas de build personnalisé. Le déploiement relie un ensemble ciblé de services Google
Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods binaires Go sur le port 8080, 2 vCPU / 4 Gio par défaut ; **`max_instance_count` fixé à 1** |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — fixé à `POSTGRES_15` ; MySQL non pris en charge. Base de données créée avec le classement obligatoire `LC_COLLATE='C' LC_CTYPE='C'` |
| Stockage d'objets | Cloud Storage | Un bucket `storage` + compte de service HMAC dédié, consommé inconditionnellement via le client compatible S3 natif de GoToSocial — pas de montage GCS FUSE |
| Secrets | Secret Manager | `SUPERUSER_PASSWORD` auto-généré, paire clé d'accès/secrète S3 HMAC ; mot de passe de la base de données. Projeté via le pilote CSI Secret Store |
| Ingress | Cloud Load Balancing / Gateway API | Service `LoadBalancer` par défaut ; IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 avec le classement `C` est obligatoire.** `database_type =
  "POSTGRES_15"` est la valeur par défaut, et `GoToSocial_GKE`'s `validation.tf`
  rejette tout `database_type` non-Postgres au moment de la planification. Le job `db-init`
  crée en outre la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` —
  GoToSocial refuse de démarrer avec tout autre classement.
- **Image pré-construite, pas personnalisée.** `container_image_source = "prebuilt"`
  déploie `docker.io/superseriousbusiness/gotosocial` directement. Aucun wrapper de point d'entrée
  n'est nécessaire — la configuration se fait entièrement via des variables d'environnement `GTS_*`
  discrètes que le binaire lit nativement.
- **Pas de job de migration.** GoToSocial crée et met à jour son propre schéma
  automatiquement à chaque démarrage ; `db-init` ne prépare que la base de données et le rôle
  avec classement C.
- **`max_instance_count` est fixé à 1.** Le cache en cours de traitement de GoToSocial
  n'a pas de synchronisation inter-instances ; l'amont ne prend pas en charge plusieurs
  instances sur la même base de données/stockage. `min_instance_count = 0`
  (mise à l'échelle à zéro) est sûr.
- **Cloud SQL est atteint via le bouclage du sidecar cloud-sql-proxy —
  `GTS_DB_TLS_MODE = "disable"` est correct sur GKE**, contrairement à Cloud Run (voir
  l'explication du mode TLS du guide CloudRun). L'implémentation `App_GKE` de
  `db_host_env_var_name` préfère `127.0.0.1` lorsque le sidecar
  est présent, donc la valeur par défaut de la couche commune de `GoToSocial_Common` est utilisée
  sans modification — `GoToSocial_GKE`'s `module_env_vars` local est vide.
- **Pas de montage GCS FUSE.** Le stockage des médias/avatars/pièces jointes utilise le
  client compatible S3 natif de GoToSocial pointant vers le point de terminaison XML d'interopérabilité S3 de GCS via un
  compte de service HMAC dédié — pas un montage de système de fichiers.
- **Les sondes de santé sont TCP, pas HTTP.** Les points de terminaison `/readyz`/`/livez`
  de GoToSocial rejettent toute requête sans en-tête `User-Agent` avec une
  réponse anti-scraper `418` — le prober HTTP intégré de Kubernetes n'en envoie
  jamais. Les deux `startup_probe` et `liveness_probe` sont TCP sur le port 8080.
- **Le compte administrateur est créé automatiquement au mieux, mais non
  garanti.** Contrairement à Cloud Run, l'ordonnancement plus lâche des jobs d'initialisation de GKE
  donne à la boucle de réessai du job `admin-create` une réelle chance de gagner la course
  contre le démarrage du pod principal — mais il peut toujours perdre. Voir §3.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail GoToSocial {#a-gke-autopilot--the-gotosocial-workload}

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail GoToSocial
  pour les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress
  affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name=gotosocial" 2>/dev/null \
    || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GoToSocial stocke toutes les données d'application (comptes, statuts, suivis, métadonnées de médias)
dans une instance Cloud SQL pour PostgreSQL 15 gérée, créée avec le
classement obligatoire `C` par le job `db-init`. Les pods l'atteignent via le
**sidecar cloud-sql-proxy** sur `127.0.0.1` ; aucune IP publique n'est exposée.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~gotosocial"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — médias, avatars, pièces jointes {#c-cloud-storage--media-avatars-attachments}

Un bucket **Cloud Storage** dédié (suffixe `storage`) et un compte de service
détenant une **clé HMAC** sont provisionnés automatiquement, accordant au SA de stockage
`roles/storage.objectAdmin` sur le bucket. GoToSocial écrit dans ce
bucket inconditionnellement dès le premier démarrage — `GTS_STORAGE_BACKEND=s3` n'est pas
facultatif.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
  ```

Voir [App_GKE](App_GKE.md) pour GCS Fuse (non utilisé ici) et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le conteneur principal de GoToSocial lit `GTS_STORAGE_S3_ACCESS_KEY` et
`GTS_STORAGE_S3_SECRET_KEY` comme variables d'environnement basées sur des secrets (projetées
via le pilote CSI Secret Store) ; `SUPERUSER_PASSWORD` n'est consommé que par
le job `admin-create`. Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI,
et [GoToSocial_Common](GoToSocial_Common.md) §2 pour savoir pourquoi ces secrets transitent
par `secret_ids`/`module_secret_env_vars`, et non par le champ
(mort) `secret_environment_variables` de l'objet de configuration par application.

### E. Réseau et ingress {#e-networking--ingress}

`service_type = "LoadBalancer"` et `reserve_static_ip = true` sont tous deux
des valeurs par défaut — **gardez `reserve_static_ip = true`** : sans une IP statique réservée,
`GKE_SERVICE_URL` peut revenir à un nom d'hôte interne
`*.svc.cluster.local` inaccessible avant que l'IP éphémère du LoadBalancer ne soit connue
au moment où Terraform rend les variables d'environnement du déploiement (une course documentée,
reproductible à l'échelle de la flotte, non spécifique à GoToSocial).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers
Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application GoToSocial {#3-gotosocial-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute
  `scripts/db-init.sh` en utilisant `postgres:15-alpine`. Il attend que Cloud SQL
  accepte les connexions, puis crée de manière idempotente le rôle d'application et la
  base de données avec `LC_COLLATE='C' LC_CTYPE='C'`, accorde les privilèges et signale
  au sidecar cloud-sql-proxy de s'arrêter (`POST
  http://127.0.0.1:9091/quitquitquit`) afin que le Job se termine. Peut être réexécuté
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration séparé.** GoToSocial migre son propre schéma
  automatiquement à chaque démarrage du serveur.
- **Le compte administrateur est automatique au mieux — mais confirmez-le, ne
  l'assumez pas.** GoToSocial n'a pas de flux d'inscription basé sur le web et pas de point de terminaison REST
  pour le tout premier compte. Confirmé en direct : la CLI panique avec
  `NewSignup: instance application not yet created, run the server at least
  once before creating users` à moins que le serveur principal n'ait déjà démarré
  avec succès une fois. Sur GKE, `execute_on_apply` ne contrôle que si
  **Terraform attend** un job (`App_GKE/jobs.tf` :
  `wait_for_completion = try(execute_on_apply, true)`) — le pod Job sous-jacent est
  toujours planifié immédiatement, en concurrence avec le premier pod du déploiement principal.
  `admin-create.sh` réessaie jusqu'à 20 fois à intervalles de 15 secondes pour
  absorber cette course et gagne souvent pendant le même `apply` — mais ce n'est pas
  garanti. Vérifiez que le compte existe (Tâche 2 dans le lab) et redéclenchez
  manuellement s'il n'existe pas :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<admin-create-job-name>
  kubectl create job --from=job/<admin-create-job-name> <admin-create-job-name>-retry -n "$NAMESPACE"
  ```
  Récupérez le mot de passe généré :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~superuser-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
- **Ligne de compte orpheline — un mode de défaillance réel et récurrent, pas un cas isolé.**
  Si une tentative `admin-create` échoue en cours de route (le cas courant : elle
  a fait la course avec le démarrage du serveur et a perdu en cours de route, ou a été interrompue), le flux
  `NewSignup` de GoToSocial peut laisser la ligne de table `accounts` insérée sans la
  ligne `users` correspondante (elle insère d'abord le compte, puis panique à l'étape de la ligne utilisateur si l'application de l'instance n'existe pas encore). Une nouvelle tentative échoue alors de manière confuse : `IsUsernameAvailable` signale "déjà utilisé" (la
  ligne de compte orpheline existe), mais `GetAccountByUsernameDomain`/
  `GetUserByAccountID` (utilisé à la fois par une nouvelle tentative `create` et
  `admin account promote`) ne trouve rien, paniquant avec
  `sql: no rows in result set` — un symptôme qui ressemble à un bug complètement
  différent. **Solution :** connectez-vous directement à la base de données (par exemple, un pod de débogage
  `postgres:15-alpine` ponctuel sur GKE, en utilisant les identifiants de la base de données de Secret
  Manager) et exécutez :
  ```sql
  SELECT id, username, domain FROM accounts WHERE username='<username>';
  DELETE FROM account_settings WHERE account_id='<the id above>';
  DELETE FROM account_stats WHERE account_id='<id>';
  DELETE FROM accounts WHERE id='<id>';
  ```
  puis réessayez `admin-create` proprement. Cela peut se reproduire à chaque déploiement où la
  première tentative fait la course avec le démarrage et perd — voir la Tâche 5 du lab pour la
  procédure complète.
- **Chemin de santé — TCP uniquement, et pourquoi `curl` a besoin d'un `User-Agent`.** GoToSocial
  sert de véritables points de terminaison `/readyz` (DB `SELECT`, 500 en cas d'échec) et
  `/livez` (200 bon marché) non authentifiés, mais les deux rejettent toute requête sans un
  en-tête `User-Agent` avec une réponse `418 I'm a teapot` — confirmé en direct.
  Le prober HTTP de Kubernetes n'en envoie jamais, donc les deux `startup_probe` et
  `liveness_probe` restent TCP sur le port 8080. Chaque commande de vérification manuelle
  nécessite un drapeau `-A`/`--user-agent` explicite :
  ```bash
  curl -A "gotosocial-check/1.0" -s "http://${EXTERNAL_IP}/readyz"
  ```
- **Propagation IAM du stockage.** GoToSocial panique au démarrage s'il ne peut pas atteindre
  son backend de stockage S3. L'octroi `roles/storage.objectAdmin` du SA de stockage
  est câblé contre la sortie `storage_buckets` de la Fondation (pas un
  `depends_on` de module entier, ce qui provoquerait un blocage) — mais un premier
  déploiement frais peut toujours voir le tout premier pod démarrer en concurrence avec le délai de propagation de l'octroi IAM (~1-2
  minutes), produisant un bref crash-loop `Access Denied` qui
  se résout de lui-même.
- **Inspecter les jobs d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'GTS_HOST|GTS_STORAGE|GTS_DB'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour GoToSocial sont listés ; toute autre entrée
est héritée de [App_GKE](App_GKE.md) avec son comportement standard et
ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotosocial` | Nom de base des ressources. Doit être en minuscules. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `GoToSocial` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `GoToSocial — a lightweight, self-hosted ActivityPub/Fediverse server, on GKE Autopilot` | Champ de description de la charge de travail. |
| `application_version` | `latest` | Tag d'image Docker Hub. |
| `host` | `gotosocial.local` | `GTS_HOST` — le domaine public. Intégré à chaque URI ActivityPub au moment de la création, **immuable après le premier démarrage**. Définissez votre vrai domaine avant la production. |
| `account_domain` | `""` | `GTS_ACCOUNT_DOMAIN` — domaine de poignée de vanité facultatif, distinct de `host`. Par défaut `host` lorsqu'il est vide. Même risque d'immuabilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle de Docker Hub — aucune construction personnalisée n'est nécessaire. |
| `min_instance_count` | `0` | La mise à l'échelle à zéro est sûre — la contrainte d'instance unique de GoToSocial concerne la concurrence, pas la chaleur. |
| `max_instance_count` | `1` | **Plafond architectural strict** — le cache en cours de traitement de GoToSocial n'a pas de synchronisation inter-instances. Ne pas augmenter. |
| `container_port` | `8080` | Valeur par défaut native `GTS_PORT` de GoToSocial. Doit correspondre aux ports de sonde, sinon le pod ne devient jamais prêt. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/mémoire par pod. |
| `enable_cloudsql_volume` | `true` | Exécute le sidecar cloud-sql-proxy — GoToSocial se connecte via son bouclage `127.0.0.1`. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

Comportement standard `App_GKE` — voir [App_GKE](App_GKE.md).

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Application publique — laisser `LoadBalancer`. |
| `workload_type` | `null` (résout en `Deployment`) | GoToSocial n'a pas besoin d'un PVC StatefulSet — les médias résident dans GCS via le client S3. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, `/readyz` (chemin d'information uniquement), `initial_delay_seconds=15`, `failure_threshold=10` | Le seul type de sonde qui fonctionne avec les points de terminaison de santé de GoToSocial protégés par User-Agent. |
| `liveness_probe` | TCP, `/livez`, `initial_delay_seconds=30`, `failure_threshold=3` | Même raisonnement que `startup_probe`. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, divers | Sondes structurées au niveau de la fondation ; remplacées par `startup_probe`/`liveness_probe` ci-dessus pour ce module. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne Filestore. **Non utilisé par GoToSocial** — le stockage des médias se fait via le client S3 natif, pas un montage. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket générique `data` (remplacé) | `main.tf` fournit le bucket `storage` réel via la sortie de `GoToSocial_Common`, consommé inconditionnellement dès le premier démarrage — non opt-in comme les buckets S3 d'autres applications. |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse monté par défaut. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | GoToSocial n'a aucune dépendance Redis — son cache est en cours de traitement. Laisser `false`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Validé au moment de la planification** — `validation.tf` rejette tout sauf PostgreSQL 13/14/15 ou `NONE`. |
| `application_database_name` | `gotosocial` | La base de données réellement créée (avec le classement `C`) et injectée comme `GTS_DB_DATABASE`. |
| `application_database_user` | `gotosocial` | Le rôle réellement créé et injecté comme `GTS_DB_USER` ; mot de passe auto-généré dans Secret Manager. |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `GTS_DB_ADDRESS` / `GTS_DB_PORT` / `GTS_DB_USER` / `GTS_DB_DATABASE` / `GTS_DB_PASSWORD` | **Définis par `main.tf`, non laissés à leurs valeurs par défaut de variables génériques vides** — le mécanisme qui permet au binaire GoToSocial de lire les informations de connexion à la base de données de la Fondation. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle par défaut. GoToSocial est informé que HTTPS est utilisé (cookies `GTS_PROTOCOL=https`, `Secure`) uniquement lorsque `application_domains` est également défini ; sur une IP nue, il s'exécute en tant que `http`. |
| `application_domains` | `[]` | S'il est vide, un nom d'hôte de type `nip.io` basé sur l'IP statique réservée est utilisé. |
| `reserve_static_ip` | `true` | **Gardez `true`** — voir §2E pour la course DNS interne que cela évite. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe du LoadBalancer (réservée par défaut). |
| `service_url` | URL pour atteindre GoToSocial. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le sidecar Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de médias `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `admin-create`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Le propre `GoToSocial_GKE` de `validation.tf` bloque en outre `min_instance_count > max_instance_count`, `enable_redis = true` sans `redis_host` ni `enable_nfs`, `database_type` loin de PostgreSQL, `enable_iap = true` sans les deux identifiants OAuth, et `enable_cloudsql_volume = true` avec `database_type = "NONE"`.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `host` (`GTS_HOST`) | Définissez votre vrai domaine avant le premier déploiement | Critique | Intégré à chaque URI d'acteur/objet ActivityPub au moment de la création ; le modifier après l'existence de comptes/publications réels interrompt la fédération pour tout ce qui a été créé sous l'ancienne valeur. |
| `max_instance_count` | `1` (ne pas augmenter) | Critique | Le cache en cours de traitement de GoToSocial n'a pas de synchronisation inter-instances ; l'amont ne prend pas en charge plusieurs instances sur la même base de données/stockage. |
| `database_type` | `POSTGRES_15` | Critique | Validé au moment de la planification par le propre `GoToSocial_GKE` de `validation.tf` — MySQL/SQL Server sont rejetés avant l'application. |
| `container_port` / ports de sonde | `8080` partout | Critique | Une non-concordance fait que la sonde atteint un port mort et le pod ne devient jamais prêt même si l'application est saine. |
| Câblage IAM du stockage (`google_storage_bucket_iam_member`) | Laisser tel quel (références `module.app_gke.storage_buckets["storage"]`) | Critique | GoToSocial panique au démarrage sans accès S3. Une alternative `depends_on = [module.app_gke]` bloquerait le déploiement contre sa propre condition préalable IAM. |
| Récupération `admin-create` | Suivez la correction SQL de la ligne de compte orpheline si une nouvelle tentative panique avec "aucune ligne" | Élevé | Une première tentative partiellement échouée peut laisser une ligne `accounts` orpheline sans ligne `users` correspondante ; les nouvelles tentatives naïves échouent de manière confuse sans le SQL de nettoyage. |
| Sondes de santé (`startup_probe`/`liveness_probe`) | Laisser `type = "TCP"` | Élevé | Les `/readyz`/`/livez` de GoToSocial rejettent toute requête sans en-tête `User-Agent` (`418`) ; passer à `type = "HTTP"` fait échouer la sonde indéfiniment, car le prober de Kubernetes n'en envoie jamais. |
| Résultat du job `admin-create` | Vérifiez, ne supposez pas | Élevé | L'ordonnancement plus lâche des jobs de GKE permet souvent à `admin-create` de gagner automatiquement sa course contre le démarrage du pod, mais pas toujours — confirmez que le compte existe avant de considérer le déploiement comme pleinement opérationnel. |
| `reserve_static_ip` | `true` (par défaut) | Moyen | Sans cela, `GKE_SERVICE_URL` peut revenir à un nom d'hôte interne `*.svc.cluster.local` inaccessible avant que l'IP éphémère du LoadBalancer ne soit connue — une course documentée à l'échelle de la flotte. |
| Vérifications manuelles `curl`/de santé | Toujours passer `-A "<agent>"` | Moyen | Les `curl` nus (et la plupart des clients/moniteurs HTTP par défaut) obtiennent `418 I'm a teapot` de la porte User-Agent anti-scraper de GoToSocial, même sur les points de terminaison "non authentifiés". |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_nfs` | `false` (par défaut) | Faible | GoToSocial n'utilise pas le montage NFS dans sa configuration par défaut, et Filestore est facturé que l'application y écrive ou non. |
| `enable_redis` | `false` (par défaut) | Faible | GoToSocial n'a aucune dépendance Redis ; laisser ce `true` n'a aucun effet fonctionnel. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à GoToSocial
partagée avec la variante Cloud Run (secrets, les jobs `db-init`/`admin-create`,
et le compte de service de stockage) est décrite dans
**[GoToSocial_Common](GoToSocial_Common.md)** (source du module :
`modules/GoToSocial_Common`).

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : GoToSocial sur GKE Autopilot](../labs/GoToSocial_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [GoToSocial Common — Configuration d'application partagée](GoToSocial_Common.md) — la configuration partagée par les deux cibles de déploiement.
