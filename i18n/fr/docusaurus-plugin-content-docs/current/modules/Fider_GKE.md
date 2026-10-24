---
title: "Fider sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Fider sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Fider_GKE.md @ e69407af sha256:09faddd79d85 -->

# Fider sur GKE Autopilot {#fider-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Fider_GKE.png" alt="Fider sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Fider est un tableau de feedback et de vote de fonctionnalités open source, auto-hébergé — les clients
publient des idées, votent et commentent, et vous priorisez en fonction de la demande. Ce module déploie
Fider sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Fider et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes qui sont
communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## Ce que coûte Fider sur RAD, et comment cela se compare {#what-fider-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module GKE Autopilot de Fider sur RAD coûte environ 136 $ US par mois, plus 17,50 $ US une fois par déploiement et aucune licence par utilisateur.** Pour le coût le plus bas, le [module Cloud Run](Fider_CloudRun.md) exécute le même Fider pour environ 89 $ US par mois. Fider est un tableau de feedback et de vote de fonctionnalités open source où les clients suggèrent, discutent et votent sur des idées. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement occasionnel coûte quelques dollars par mois, et non 136 $ US. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Le même |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **136 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **105 crédits par jour**, environ 3 150 par mois (environ 315 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, donc une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 2 vCPU / 4 GiB, fonctionnant en permanence | 79 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Passerelle et adresse IP Cloud NAT | 5 $ US |
| Cloud Storage pour les sauvegardes | 1 $ US |
| **Total** | **environ 136 $ US** |

Le niveau gratuit de GKE couvre les frais de gestion d'un cluster Autopilot ou zonal par compte de facturation, donc le total ci-dessus suppose qu'il s'agit de ce cluster ; sinon, ajoutez environ 73 $ US par mois.

### Comment cela se compare {#how-it-compares}

Fider a son propre plan hébergé officiel, **Fider Pro** : le plan Pro hébergé de Fider coûte 25 $/mois (éléments de feedback illimités plus modération de contenu, mois par mois) — lu le 8 octobre 2026.

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Fider Pro (plan hébergé officiel) | 25 $ US/mois | Fider |
| **RAD, GKE Autopilot, votre propre projet** | **136 $ US**, plus 17,50 $ US une fois | L'automatisation de RAD, dans votre projet |
| **RAD, GKE Autopilot, un projet géré par RAD** | **environ 3 150 crédits (315 $ US)** | RAD |
| RAD, Cloud Run | environ 89 $ US ; voir le [guide Cloud Run](Fider_CloudRun.md) | RAD |

Le prix de Fider Pro a été lu sur sa propre page de tarification le 8 octobre 2026 et a pu changer depuis — vérifiez la source avant de vous fier au chiffre.

- **Fider Pro est la comparaison fixe ; un serveur autogéré est la comparaison flexible.** Sur votre propre machine Hetzner ou DigitalOcean (2 vCPU/4 Go, environ 24 $/mois) ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go, environ 49 $/mois), vous paieriez moins en espèces que l'une ou l'autre option, mais vous géreriez vous-même le système d'exploitation, la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau — exactement ce que le Cloud SQL, Secret Manager et la surveillance gérés par RAD font pour vous.
- **Un serveur bon marché est bon marché jusqu'à ce que quelque chose tombe en panne.** Sur RAD, les sauvegardes, la récupération ponctuelle, la rotation des mots de passe via Secret Manager, et la journalisation et la surveillance proviennent de Google Cloud par défaut. Sur votre propre serveur, ou sur un plan hébergé à prix fixe sans contrôle d'infrastructure, chacun de ces éléments est un travail que quelqu'un doit encore faire ou une limite que vous ne pouvez pas modifier.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Fider s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne démantèle pas Cloud SQL, la VM ou GKE Autopilot un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 $ US) pour une chaîne de déploiement typique de 2 à 3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 136 $ US.** Déployez Fider, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures pendant lesquelles il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une lacune réelle : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, de sorte que Fider ne se met jamais à l'échelle zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 180 crédits (18 $ US). La suppression permet d'économiser de l'argent si Fider resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 4,55 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (105 crédits par jour).
- **Supprimez tout ce que Fider utilise.** La majeure partie des coûts de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Fider dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration ; [Tarification Fider Pro](https://fider.io/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Fider s'exécute comme une seule charge de travail web Go. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Fider ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Stockage de fichiers | PostgreSQL (pièces jointes) | Fider stocke les pièces jointes dans PostgreSQL ; le montage NFS optionnel est désactivé par défaut et inutilisé |
| Secrets | Secret Manager | `JWT_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée (`database_type = POSTGRES_15`) ; la sélection de tout autre moteur
  interrompt le démarrage.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il signe
  tous les jetons d'authentification et de session (y compris les liens de connexion magiques envoyés par e-mail) et
  **ne doit jamais être renouvelé après le premier démarrage** — cela invaliderait toutes les sessions actives
  et les liens de connexion en attente.
- **Fider est un binaire Go unique sans worker en arrière-plan.** Tout l'état réside dans
  PostgreSQL ; il n'y a pas de processus de file d'attente. Un minimum de 1 réplica est conservé (GKE ne
  prend pas en charge la mise à l'échelle à zéro).
- **Pas de Redis.** Fider utilise une file d'attente et un cache basés sur PostgreSQL (`VALKEY_URL` vide),
  donc `enable_redis` est par défaut `false`.
- **NFS est désactivé par défaut** (`enable_nfs = false`). Fider stocke les pièces jointes dans
  PostgreSQL et ce module ne le bascule jamais en mode système de fichiers, donc un partage NFS
  ne recevrait rien. Si vous l'activez, App_GKE déploie le pod avec la
  stratégie `Recreate` plutôt que `RollingUpdate`.
- **Le conteneur écoute sur le port 3000.** Sur GKE, la variable d'environnement `PORT` n'est **pas** injectée automatiquement,
  donc le point d'entrée exporte `PORT = 3000` ; `container_port` et les sondes Kubernetes
  doivent toutes deux être 3000 ou le pod ne deviendra jamais Prêt même si l'application est saine.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée personnalisé exécute `./fider migrate`
  avant de démarrer le serveur.
- **L'e-mail est désactivé pour la démo.** Des valeurs SMTP de remplacement permettent à l'application de démarrer ;
  les liens d'inscription / d'invitation sont imprimés dans le journal du pod jusqu'à ce qu'un véritable SMTP soit configuré via
  `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Fider {#a-gke-autopilot--the-fider-workload}

Les pods Fider sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Fider pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Déploiement vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Fider stocke toutes les données d'application (publications, votes, commentaires, utilisateurs, paramètres) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. Les pods l'atteignent en privé via le
sidecar **Cloud SQL Auth Proxy** sur la boucle de retour `127.0.0.1` ; aucune IP publique n'est exposée. Lors du
premier déploiement, le Job `db-init` crée le rôle et la base de données de l'application ; Fider exécute ensuite
ses propres migrations au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement.
Le compte de service de la charge de travail se voit accorder l'accès. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

NFS est **désactivé par défaut** (`enable_nfs = false`) : Fider conserve les pièces jointes dans
PostgreSQL, donc le montage est inutilisé. Si vous l'activez, la VM de serveur NFS partagée (gérée
par `Services_GCP`) doit être `RUNNING` avant le déploiement de l'application, et les pods basés sur NFS utilisent la
stratégie de mise à jour `Recreate`.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Fider n'utilise **pas** Redis — ne vous attendez pas à un point de terminaison Memorystore ou Redis.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`JWT_SECRET` (signe les jetons d'authentification et de session). Il est livré dans le pod
via l'intégration Secret Store CSI. Le mot de passe de la base de données est géré séparément par
la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements. Définissez
`BASE_URL` (via `environment_variables`) sur l'URL externe une fois l'IP connue.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles. Lorsque l'e-mail est
désactivé, les liens d'inscription / d'invitation apparaissent dans les journaux des pods.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Fider {#3-fider-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  le rôle et la base de données `fider`, accorde les privilèges, réaffecte la propriété du
  schéma `public` au rôle de l'application, et signale au sidecar du proxy de s'arrêter
  afin que le pod du Job se termine. Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée personnalisé exécute `./fider migrate` avant
  de lancer le serveur (le `CMD` de l'image est remplacé par `./fider` uniquement). Les migrations
  sont idempotentes, de sorte que la mise à niveau de la version de l'application applique les modifications de schéma au
  prochain démarrage sans étape de migration distincte.
- **`JWT_SECRET` est immuable après le premier démarrage.** Il est généré une fois et écrit dans
  Secret Manager. Le modifier invalide toutes les sessions utilisateur actives et tous les liens de connexion
  envoyés par e-mail en attente. Ne le faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Configuration initiale.** Il n'y a pas de identifiants par défaut. Accédez à l'IP externe / URL du LoadBalancer
  pour créer le site et son propriétaire administrateur :
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```
- **L'e-mail est désactivé par défaut.** Des valeurs SMTP de remplacement permettent à Fider de démarrer avec
  `EMAIL_NOEMAIL = true` ; les liens d'inscription et d'invitation sont imprimés dans le journal du pod. Pour envoyer
  un vrai courrier, définissez les variables SMTP de Fider via `environment_variables` et supprimez
  `EMAIL_NOEMAIL`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/_health` — un point de terminaison non authentifié
  renvoyant `200`. Le `container_port` et le port de la sonde doivent tous deux être **3000**
  (le point d'entrée exporte `PORT = 3000` ; GKE ne l'injecte pas automatiquement).
- **Les mises à jour basées sur NFS utilisent `Recreate`** (uniquement lorsque `enable_nfs = true`). Une mise à jour progressive exécuterait brièvement deux pods
  contre le même volume NFS et la même base de données partagée ; App_GKE définit donc la stratégie
  sur `Recreate` pour les applications basées sur NFS.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Fider sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fider` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Fider (`getfider/fider:<tag>`), mappé à l'ARG de build `FIDER_VERSION`. `latest` est épinglé à `stable` (aucun tag `:latest` n'existe) ; épingler à un tag SHA en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimum de réplicas ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `5` | Nombre maximum de réplicas. |
| `container_port` | `3000` | Fider écoute sur le port 3000 ; les sondes doivent correspondre. |
| `container_resources` | 2 vCPU / 4 GiB | Limites et requêtes CPU/mémoire pour le conteneur Fider. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Fider dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Connectez un vrai SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) ou l'URL externe `BASE_URL` ici. Ne définissez pas `DATABASE_URL`, `JWT_SECRET` ou `PORT`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Résout en `Deployment` (la logique intégrée du module) ; Fider est sans état (l'état réside dans PostgreSQL). |
| `session_affinity` | `ClientIP` | Routage persistant (par défaut). |
| `container_protocol` | `http1` | Fider sert du HTTP/1.1 standard. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Par défaut, la logique intégrée du module. Fider stocke l'état dans PostgreSQL, donc les PVC par pod ne sont pas requises. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Laisser désactivé : Fider stocke les pièces jointes dans PostgreSQL et n'écrit jamais sur le montage. Les pods basés sur NFS se déploient avec `Recreate`. |
| `nfs_mount_path` | `/opt/fider/storage` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fider est basé sur Postgres ; laisser désactivé sauf si externalisé vers Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si Redis est activé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Fider nécessite PostgreSQL 15+. |
| `application_database_name` | `fider` | Nom de la base de données de l'application. Immuable après le premier déploiement. |
| `application_database_user` | `fider` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Fider. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `JWT_SECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives et les liens de connexion par e-mail en attente. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Tout moteur non-PostgreSQL interrompt le démarrage — Fider est uniquement compatible avec Postgres. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide fait échouer le job d'importation. |
| `container_port` | `3000` | Élevé | GKE n'injecte pas automatiquement `PORT` ; un port non concordant fait que les sondes atteignent un port mort et le pod ne devient jamais Prêt. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `application_version` | épingler un tag SHA ; `latest` → `stable` | Élevé | `getfider/fider` n'a pas de tag `:latest` ; le module épingle `latest` à `stable`, mais épinglez explicitement pour des mises à niveau reproductibles. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `enable_nfs` | `false` (par défaut) | Moyen | Fider n'utilise pas le montage. S'il est activé, la VM NFS partagée doit être `RUNNING` avant le déploiement, et les pods basés sur NFS utilisent `Recreate`, de sorte qu'un déploiement interrompt brièvement le pod. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| SMTP (`EMAIL_SMTP_*`) | Configurer pour un vrai courrier | Moyen | Laissés comme espaces réservés, les liens d'inscription / d'invitation n'apparaissent que dans les journaux — aucun e-mail n'est envoyé. |
| `enable_iap` | uniquement lorsque l'accès public n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris la navigation anonyme sur le tableau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Fider partagée avec la variante Cloud Run est décrite dans
**[Fider_Common](Fider_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Fider sur GKE Autopilot](../labs/Fider_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Fider sur Google Cloud Run](Fider_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Fider Common — Configuration d'application partagée](Fider_Common.md) — la configuration partagée par les deux cibles de déploiement.
