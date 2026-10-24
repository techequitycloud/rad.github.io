---
title: "Emby sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Emby sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Emby_GKE.md @ e69407af sha256:29615f7122eb -->

# Emby sur GKE Autopilot {#emby-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Emby_GKE.png" alt="Emby sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Emby est un serveur multimédia auto-hébergé pour organiser et diffuser vos
propres films, séries télévisées, musiques et photos, avec des applications
clientes pour la plupart des téléviseurs, téléphones et navigateurs. La lecture
de base, la diffusion sans transcodage et l'assistant de configuration sont
gratuits — aucune clé de licence ou compte emby.media n'est requis pour démarrer
ou naviguer. Emby Premiere, un module complémentaire payant acheté séparément
dans l'application, gère le transcodage accéléré par le matériel, les
applications mobiles/TV complètes, le DVR/TV en direct et la synchronisation
hors ligne ; cela diffère de Jellyfin (également dans ce catalogue), un fork
communautaire du code source original d'Emby Server qui est entièrement
open-source sans niveau payant équivalent. Ce module déploie Emby sur **GKE
Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Emby utilise et sur la façon de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et le cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Emby sur RAD, et comment cela se compare {#what-emby-costs-on-rad-and-how-that-compares}

**Le module Emby sur GKE Autopilot de RAD coûte environ 42,08 $ US par mois.** Un
serveur autogéré est moins cher en espèces, mais vous gérez alors le système
d'exploitation, les correctifs de sécurité et les mises à niveau vous-même. Pour
le coût le plus bas, le [guide Cloud Run](Emby_CloudRun.md) exécute le même Emby
pour environ 19,14 $ US par mois. Les chiffres sont à jour au 8 octobre 2026 ;
les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — études, démo, activité saisonnière
— un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour
une poignée de crédits, de sorte que les 42,08 $ US deviennent quelques dollars
par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42,08 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un abonnement
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 1 GiB | 36,08 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 42,08 $ US** |

### Comment cela se compare {#how-it-compares}

- Emby ne vend pas d'hébergement — il n'y a pas de "Emby Cloud" à comparer —
  donc la comparaison d'hébergement honnête est un VPS nu : la valeur par
  défaut d'Emby est plus légère que la classe de 2 vCPU à environ 24 $/mois que
  ces fournisseurs proposent, donc un niveau plus petit et moins cher des mêmes
  fournisseurs est suffisant.
- Séparément, et sur **tout** hôte, y compris RAD : la lecture de base d'Emby
  est gratuite, mais **Emby Premiere** — transcodage accéléré par le matériel,
  applications mobiles/TV complètes, DVR/TV en direct, synchronisation hors
  ligne — est un module complémentaire payant à 4,99 $ US par mois, 54 $ US par
  an, ou 119 $ US une fois pour une licence à vie. Ce coût est le même, que
  Emby fonctionne sur RAD, un VPS ou une machine de rechange à la maison.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Emby s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela
convient bien mieux à un Emby dont vous n'avez besoin qu'occasionnellement —
études, démo, activité saisonnière — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un seul module, cela ne
  détruit pas le pod GKE ou son réseau un par un — l'ensemble du projet, et tout
  ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans
  les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture plus les frais de module.
  Cela coûte **une poignée de crédits (moins de 1 $ US)** au total pour une
  chaîne de déploiement typique de la taille d'Emby, contre les 72 crédits (7,20
  $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 42,08 $ US.** Déployez Emby, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé.
  Vous ne payez les frais de module qu'une seule fois, les builds, et les
  heures pendant lesquelles Emby était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un
  projet que vous apportez et dont RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du
  niveau (100 crédits pour le niveau sandbox que la plupart des utilisations
  d'étude et de démo conviennent). Google indique que la plupart des services
  sont de nouveau pleinement fonctionnels dans les 36 heures suivant une
  restauration.
- **Un véritable point à vérifier.** Tout ce vers quoi vous avez pointé Emby
  pour votre bibliothèque multimédia — si elle se trouve dans le propre
  stockage de ce déploiement plutôt que dans une bibliothèque externe — suivez
  la même règle qu'ailleurs : copiez tout ce qui est irremplaçable avant de
  supprimer, car les objets Cloud Storage sans suppression logicielle activée
  ne survivent pas de manière fiable à la suppression d'un projet, même si le
  projet lui-même le fait.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à
l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet
géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le
redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 80 crédits (7,95 $ US), et environ une heure, car RAD
  recrée le projet et les services partagés avant Emby. La suppression permet
  d'économiser de l'argent une fois qu'Emby resterait inutilisé pendant environ
  **6 jours ou plus** dans votre propre projet (environ 1,40 $ US par jour), ou
  environ **1 jour ou plus** dans un projet géré par RAD (67 crédits par jour).
- **Supprimez tout ce qu'Emby utilise.** La configuration par défaut d'Emby ne
  comporte pas de base de données ou de VM séparée, donc sa suppression arrête
  essentiellement tous ses propres coûts d'exécution immédiatement.
- **Gardez vos données en premier.** Vérifiez tout stockage que vous avez
  attaché pour votre bibliothèque multimédia et la propre configuration d'Emby
  avant de supprimer — le module lui-même ne contient aucune base de données
  nécessitant une exportation séparée.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour
  vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient Emby dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire
  exécute Emby pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration. [Tarification Emby
Premiere](https://emby.media/premiere.html) pour les chiffres de licence des
modules complémentaires ;

## 1. Vue d'ensemble {#1-overview}

Emby s'exécute comme une charge de travail avec état. Sur GKE, c'est l'**endroit
recommandé pour une véritable bibliothèque multimédia** : un StatefulSet
soutenu par un véritable **PVC de bloc** à `/config` offre une sémantique de
système de fichiers POSIX correcte pour SQLite et le cache de transcodage. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod StatefulSet, 1 vCPU / 1 GiB par défaut |
| Persistance | Persistent Disk (PVC de bloc) | `/config` sur un PVC par pod — le stockage recommandé pour SQLite + cache de transcodage |
| Base de données | SQLite interne (embarquée) | Pas de Cloud SQL — Emby conserve tout l'état dans des fichiers SQLite sous `/config` |
| Stockage d'objets / de fichiers | Cloud Storage (GCS FUSE) / Filestore (NFS) | Optionnel, pour les grandes bibliothèques multimédias |
| Secrets | Secret Manager | Clé API auto-générée optionnelle ; pas de secrets cryptographiques obligatoires |
| Ingress | Cloud Load Balancing | `LoadBalancer` par défaut (serveur interactif, orienté client) ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Emby stocke tout son état — la
  bibliothèque SQLite et les bases de données de lecture, la configuration, les
  métadonnées et illustrations mises en cache, les plugins, le cache de
  transcodage et les journaux — sous `/config`. Aucune instance Cloud SQL, aucun
  job `db-init` et aucun Redis n'est utilisé (`database_type = NONE` ; les variables Redis de la
  fondation sont inertes pour Emby).
- **Un PVC de bloc à `/config` est la valeur par défaut, et doit rester activé.**
  `stateful_pvc_enabled = true` (la valeur par défaut) résout la charge de travail en un
  **StatefulSet** avec un PVC par pod monté à `/config`, et le volume de stockage
  GCS se désactive automatiquement pour éviter un double montage. Le stockage
  de bloc réel offre la sémantique de système de fichiers correcte dont SQLite
  et le cache de transcodage ont besoin ; GCS FUSE ne peut pas héberger les
  bases de données SQLite d'Emby.
- **Le conteneur écoute sur le port 8096.** Le port web/API d'Emby est défini
  par Emby_Common. L'interface utilisateur web et l'assistant de
  configuration de première exécution sont servis à `/web` (et `/`).
  Contrairement à Jellyfin, Emby n'a **pas de point de terminaison de santé
  HTTP non authentifié confirmé et documenté** — un test de conteneur en direct
  a révélé que `/health` renvoie `404` tandis que `/` répond `302` à
  l'assistant de configuration — donc les deux sondes utilisent par défaut une
  vérification **TCP** sur le port 8096 au lieu d'un chemin HTTP supposé.
- **Il n'y a pas d'identifiants par défaut.** Lors du premier accès,
  l'assistant de configuration crée le compte administrateur et ajoute des
  bibliothèques multimédias. Rien n'est utilisable avant cela.
- **Réplica unique.** `min_instance_count = 1` / `max_instance_count = 1` — une bibliothèque SQLite partagée sur
  un seul volume. **Ne pas exécuter plusieurs réplicas** ; les écritures
  concurrentes sur un seul fichier SQLite corrompent la bibliothèque.
- **NFS est optionnel, pour les grandes bibliothèques.** `enable_nfs = false` par défaut.
  Activez-le pour monter un volume Filestore partagé pour une grande collection
  multimédia qui dépasse la taille d'un seul PVC.
- **L'authentification par clé API est optionnelle et désactivée par défaut.**
  `enable_api_key = false`. L'authentification principale est le compte administrateur créé par
  l'assistant ; les clés API par application sont créées dans l'application
  sous **Tableau de bord → Clés API**. La valeur générée par Secret Manager est
  injectée en tant que `EMBY_API_KEY` — pour les opérateurs qui souhaitent un
  identifiant stable à transmettre aux clients API externes, et non quelque
  chose qu'Emby lui-même lit au démarrage.
- **Emby Premiere est un niveau payant séparé et optionnel.** Cela n'a aucune
  incidence sur le succès du déploiement de ce module ou sur le
  fonctionnement du streaming de base — cela ne fait que restreindre les
  fonctionnalités optionnelles client/DVR/transcodage matériel que l'opérateur
  peut déverrouiller ultérieurement.

> **GKE vs Cloud Run — GKE est le serveur multimédia de production.**
> **GKE (ce module)** exécute Emby en tant que StatefulSet avec un véritable
> **PVC de bloc** à `/config`, offrant une véritable sémantique POSIX pour SQLite
> et le cache de transcodage, plus un **NFS** optionnel pour les grandes
> bibliothèques multimédias — le choix recommandé pour un véritable serveur
> multimédia multi-utilisateur avec transcodage. **[Emby_CloudRun](Emby_CloudRun.md)**
> monte `/config` à partir d'un bucket GCS via FUSE ; c'est plus simple et moins
> cher pour une démo ou une petite bibliothèque personnelle, mais la latence
> FUSE et le modèle de délai d'attente par requête le rendent peu adapté au
> transcodage en direct ou au streaming intensif.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Emby {#a-gke-autopilot--the-emby-workload}

Les pods Emby sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. Avec un PVC de bloc, la charge de travail est un
StatefulSet avec une identité de pod stable et des redémarrages ordonnés.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Emby pour voir les pods, les événements et le StatefulSet.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Stockage de configuration persistant (SQLite sur le PVC) {#b-persistent-configuration-store-sqlite-on-the-pvc}

Emby n'a **pas de base de données externe**. Tout son état — la bibliothèque
SQLite et les bases de données de lecture, la configuration, les métadonnées et
illustrations mises en cache, les plugins installés, le cache de transcodage et
les journaux — se trouve sous `/config` (`EMBY_CONFIG_DIR = /config`). Il n'y a pas
d'instance Cloud SQL, pas de proxy d'authentification et pas de job
d'initialisation pour créer un schéma ; Emby crée et migre ses propres bases de
données SQLite au premier démarrage.

Sur GKE, `/config` est soutenu par un **PVC de bloc** par pod (`stateful_pvc_enabled = true`, monté
à `/config`), qui est le stockage recommandé car SQLite et le cache de
transcodage ont besoin d'une véritable sémantique de système de fichiers POSIX
que le stockage d'objets ne peut pas fournir.

- **Inspecter le PVC et son disque lié :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

### C. Cloud Storage et NFS (optionnel, pour les grandes bibliothèques) {#c-cloud-storage--nfs-optional-for-large-libraries}

Le bucket **Cloud Storage** auto-provisionné (suffixe de nom `storage`, `STANDARD`,
`force_destroy = true`, versioning désactivé, `public_access_prevention = enforced`) est disponible pour des
montages GCS FUSE supplémentaires. Lorsqu'un PVC de bloc est activé, le volume
de stockage GCS est automatiquement désactivé pour `/config` afin d'éviter un
double montage. Pour les grandes collections multimédias, activez **NFS**
(`enable_nfs = true`) pour monter un volume Filestore partagé.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et le pilote CSI GCS FUSE.

### D. Configuration initiale et bibliothèque multimédia {#d-first-run-setup--the-media-library}

Lors du premier accès, Emby sert un **assistant de configuration** interactif à
`/web` (et `/`) qui crée le compte administrateur, définit la langue
préférée et vous permet d'ajouter des bibliothèques multimédias (Films, TV,
Musique, Photos). Rien n'est authentifié ou utilisable tant que vous n'avez pas
terminé l'assistant — il n'y a pas d'identifiants par défaut.

Les bibliothèques multimédias pointent vers des chemins à l'intérieur du
conteneur : le PVC de bloc à `/config`, un montage NFS optionnel pour les grandes
collections, ou des volumes GCS FUSE supplémentaires.

- **Accéder à l'assistant / à l'interface utilisateur web :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"      # external IP / hostname
  kubectl port-forward -n "$NAMESPACE" statefulset/<service-name> 8096:8096
  # then open http://localhost:8096/web
  ```

### E. Secret Manager et la clé API optionnelle {#e-secret-manager--the-optional-api-key}

Emby ne nécessite **aucun secret cryptographique obligatoire** — il n'y a pas
de clé de chiffrement, de JWT ou de mot de passe maître à gérer. Lorsque
`enable_api_key = true`, le module génère une valeur aléatoire de 32 caractères et la stocke
dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key` (affichée comme sortie `emby_api_key_secret_id`),
injectée comme `EMBY_API_KEY` via le chemin normal `module_secret_env_vars`/SecretSync (un nom de
variable d'environnement à un seul underscore, valide comme `targetKey`
SecretSync). Emby lui-même n'a pas de variable d'environnement qui consomme
cela au démarrage — la seule façon d'obtenir une clé API utilisable dans Emby
est dans l'application sous **Tableau de bord → Clés API** ; ce secret existe
en tant qu'identifiant stable, soutenu par Secret Manager, que les opérateurs
peuvent référencer en externe. L'authentification principale reste le compte
administrateur de l'assistant.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut `service_type = LoadBalancer` (Emby est un serveur multimédia interactif, orienté client),
ce qui donne au Service une adresse IP externe. Définissez `service_type = ClusterIP` si vous
avez l'intention de le garder interne uniquement, ou activez un domaine
personnalisé avec un certificat géré par Google via l'API Kubernetes Gateway.
Une adresse IP statique est réservée par défaut afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des stratégies d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Emby {#3-emby-application-behaviour}

- **Pas de job d'initialisation.** Emby n'a pas besoin d'étape `db-init` — il
  crée et migre ses propres bases de données SQLite sous `/config` la première
  fois qu'il démarre. Laissez `initialization_jobs` vide, sauf si vous avez des tâches de
  chargement de données personnalisées.
- **L'assistant de première exécution crée l'administrateur.** L'assistant de
  configuration `/web` vous guide dans la création du compte administrateur et
  l'ajout de bibliothèques. Tant qu'il n'est pas terminé, le serveur n'a pas
  d'utilisateurs et pas de contenu.
- **`/config` est la source unique de vérité — persistez-la.** Tout l'état de la
  bibliothèque se trouve sur le PVC de bloc. La suppression du PVC efface la
  bibliothèque, les plugins et les utilisateurs. Le StatefulSet maintient le
  PVC lié à l'identité du pod lors des redémarrages.
- **L'image personnalisée est un wrapper fin.** Le Dockerfile est `ARG EMBY_VERSION=4.10.0.15` /
  `FROM emby/embyserver:${EMBY_VERSION}`, de sorte que la Fondation le met en miroir dans Artifact Registry
  (`enable_image_mirroring = true`) et définit `imagePullPolicy = Always` pour l'image mise en miroir. `application_version = "latest"` se
  résout en `4.10.0.15` épinglé via l'argument de build `EMBY_VERSION` spécifique à
  l'application — il n'est **pas** écrasé par l'injection générique `APP_VERSION` de
  la Fondation. Une vérification locale `docker build` + `docker
  run` a confirmé que
  l'image démarre proprement sur seulement `EMBY_CONFIG_DIR` et atteint la logique de
  démarrage réelle d'Emby Server.
- **fsGroup pour un PVC inscriptible par le groupe.** Emby s'exécute en tant
  que UID 1000 / GID 2000 ; `stateful_fs_group = 3000` garantit que le PVC est inscriptible par le
  groupe.
- **Pas de chemin de santé dédié — sondes TCP.** Les sondes de démarrage et de
  vivacité utilisent toutes deux une vérification **TCP** sur le port 8096,
  qui passe dès que l'écouteur d'Emby se lie. Un test en direct a confirmé que
  `/health` renvoie `404` (pas de tel point de terminaison) tandis que `/`
  répond `302` à l'assistant de configuration — excluant un chemin HTTP comme
  cible de la sonde, contrairement à Jellyfin qui documente un `/health`
  fonctionnel.
- **Le transcodage est gourmand en CPU et sans GPU.** Les pods Autopilot n'ont
  pas de GPU, donc préférez les clients de lecture directe. Augmentez `cpu_limit`
  pour le transcodage en direct et `memory_limit` pour les grandes bibliothèques.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Emby sont listés ; toute autre entrée est héritée de [App_GKE](App_GKE.md) avec
son comportement standard et ses valeurs par défaut.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `emby` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Emby Media Server` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Tag d'image Emby ; `latest` épingle à `4.10.0.15` via l'argument de build `EMBY_VERSION`. |
| `enable_api_key` | `false` | Générer une clé API aléatoire dans Secret Manager (`EMBY_API_KEY`). Recommandé lorsque l'accès est possible en dehors de l'espace de noms. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; augmenter pour le transcodage en direct. |
| `memory_limit` | `1Gi` | Mémoire par pod ; augmenter pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Réplicas minimum ; maintenir à 1 (bibliothèque partagée unique). |
| `max_instance_count` | `1` | **Maintenir à 1.** Une bibliothèque SQLite partagée sur un seul volume — ne jamais exécuter plusieurs réplicas. |
| `container_port` | `8096` | Port web/API d'Emby (défini par Emby_Common ; non transféré à App_GKE). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Emby n'a pas de Cloud SQL — laisser `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir `emby/embyserver` dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | VPA optimise les requêtes ; désactive HPA lorsqu'il est activé. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires pour le conteneur Emby. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé ; par défaut externe car Emby est interactif/orienté client. |
| `workload_type` | `null` → `StatefulSet` | Se résout en StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Mode d'affinité de session pour le Service. |
| `namespace_name` | `""` | Auto-généré à partir de `application_name` + `tenant_id` lorsque vide. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes après SIGTERM avant SIGKILL — permet de vider les écritures en cours. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Activer le modèle PVC. **Conserver `true`** — les bases de données SQLite d'Emby ne peuvent pas fonctionner sur GCS FUSE ; se résout automatiquement en StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; dimensionner pour contenir `/config` (SQLite, métadonnées, cache de transcodage). |
| `stateful_pvc_mount_path` | `/config` | Chemin de montage du conteneur pour le PVC (répertoire de configuration/persistance d'Emby). |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré (SSD) ; utiliser `premium-rwo` pour des IOPS plus élevées, ou `standard` (HDD `pd-standard`) sur un projet avec des quotas limités — voir le tableau des pièges ci-dessous. |
| `stateful_headless_service` | `null` | Service sans tête pour des noms DNS de pods stables. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Redémarrages ordonnés sécurisés pour Emby. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | Stratégie de mise à jour. |
| `stateful_fs_group` | `3000` | fsGroup du pod pour que le PVC soit inscriptible par le groupe (Emby UID 1000 / GID 2000). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota` (`false`) plus `quota_cpu_requests` / `quota_cpu_limits` /
`quota_memory_requests` / `quota_memory_limits` / `quota_max_pods` /
`quota_max_services` / `quota_max_pvcs` — Quota de ressources de l'espace de noms. Les valeurs de
quota `*_requests` / `*_limits` ne sont **pas transférées** dans ce module et sont
inertes ; les valeurs de mémoire, si utilisées ailleurs, doivent porter des
suffixes d'unité binaire (`4Gi`, `8192Mi`).

### Groupe 9 — Stratégies de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP 8096, 15s de délai | Sonde de démarrage ; TCP car Emby n'a pas de chemin de santé confirmé. |
| `liveness_probe` | TCP 8096, 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | `{ enabled = true }` | Sonde de démarrage de l'infrastructure au niveau App_GKE. |
| `health_check_config` | `{ enabled = true }` | Sonde de vivacité au niveau App_GKE. |
| `uptime_check_config` | `{ enabled=false }` | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Emby n'a pas besoin de job d'initialisation ; fournir uniquement pour les tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, tâches de maintenance). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Emby. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionner Cloud Filestore (NFS) ; activer pour les grandes bibliothèques multimédias partagées. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket Emby `storage` et tout extra. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS FUSE supplémentaires via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Stratégie de nettoyage d'Artifact Registry. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

`database_type` (`NONE`), `database_password_length`, `application_database_name`
(`embydb`), `application_database_user` (`embyuser`), `enable_mysql_plugins`,
`enable_postgres_extensions`, `db_*` / `db_*_env_var_name` — **tous inertes pour
Emby** (pas de base de données SQL) ; conservés et transférés pour la
compatibilité de la fondation.

### Groupe 15 — Redis (transféré pour la compatibilité de la fondation) {#group-15--redis-forwarded-for-foundation-compatibility}

`enable_redis`, `redis_host`, `redis_port`, `redis_auth` — **non applicable à
Emby**, qui n'utilise pas de cache ou de file d'attente. Transféré à la
fondation uniquement pour la compatibilité ; laisser aux valeurs par défaut.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC) du volume `/config`. |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un instantané `/config` lors du déploiement (valeur par défaut `tar`). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable lors des redéploiements. |
| `static_ip_name` | `""` | Auto-généré lorsque vide. |

### Groupe 20 — Proxy compatible avec l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification d'identité
> Google pour **toutes** les requêtes entrantes. Nécessite que `enable_custom_domain` ou
> `enable_cdn` soit vrai.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Emby. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une stratégie Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la stratégie. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP dans le cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Emby. |
| `emby_api_key_secret_id` | ID du secret Secret Manager pour la clé API (vide lorsque `enable_api_key = false`). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour un déploiement Emby par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification — une charge de travail
> `Deployment` à côté de `stateful_pvc_enabled = true`, IAP sans identités autorisées, `quota_memory_*` sans suffixes
> d'unité binaire, un `timeout_seconds`/`backup_retention_days` hors limites. Une configuration invalide
> échoue la **planification** avec une erreur claire et nommée avant la
> création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC `/config` | Ne jamais supprimer | Critique | Le PVC contient la bibliothèque SQLite, les utilisateurs et les métadonnées ; le supprimer efface tout le serveur. |
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC persistant, `/config` est éphémère et la bibliothèque est perdue à chaque redémarrage de pod. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans une seule bibliothèque SQLite et la corrompent. |
| `workload_type` vs `stateful_pvc_enabled` | Laisser `workload_type` non défini | Critique | `Deployment` + `stateful_pvc_enabled = true` échoue au moment de la planification ; laisser non défini pour une résolution automatique en StatefulSet. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation. |
| `stateful_pvc_size` | Adapter à la bibliothèque | Élevé | Un PVC sous-dimensionné se remplit pendant la mise en cache des métadonnées/transcodage et bloque le serveur. |
| `stateful_fs_group` | `3000` | Élevé | Un fsGroup incorrect rend le PVC non inscriptible par Emby (UID 1000 / GID 2000) — le démarrage échoue. |
| `memory_limit` | `1Gi` (augmenter pour les grandes bibliothèques) | Élevé | Trop peu de mémoire tue le pod par manque de mémoire vive (OOM-kill) lors de l'analyse ou du transcodage d'une grande bibliothèque. |
| `cpu_limit` | `1000m` (augmenter pour le transcodage) | Élevé | Le transcodage en direct (sans GPU) sature le CPU ; préférer les clients en lecture directe. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| Type `startup_probe`/`liveness_probe` | `TCP` (par défaut) | Élevé | Un chemin HTTP `/health` supposé renvoie une erreur 404 sur Emby (vérifié en direct) — une sonde HTTP ici ne passerait jamais. |
| `service_type` | `LoadBalancer` (par défaut) sauf intentionnellement interne | Moyen | Une surcharge `ClusterIP` injustifiée rend un serveur multimédia interactif inaccessible depuis un navigateur. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser le pod unique pendant la maintenance, interrompant les flux. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour récupérer un instantané de bibliothèque plus ancien. |
| `stateful_pvc_storage_class` | `standard` (HDD) sur les projets avec quotas limités | Moyen | Emby est une application média/SQLite — le `standard-rwo` par défaut utilise le quota régional strict `SSD_TOTAL_GB`, et la mise à l'échelle à zéro NE libère PAS le PVC. Une campagne de modules stateful peut épuiser le quota SSD ; remplacer par HDD (`stateful_pvc_storage_class=standard`) car le modèle d'écriture d'Emby n'a pas besoin des IOPS SSD. |
| `enable_api_key` | Comprendre que c'est réservé à l'opérateur | Faible | Emby lui-même ne lit jamais `EMBY_API_KEY` au démarrage — créer des clés API in-app sous Tableau de bord → Clés API pour l'authentification REST réelle d'Emby. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Emby
partagée avec la variante Cloud Run est décrite dans
**[Emby_Common](Emby_Common.md)**. Pour une présentation guidée, voir le
[lab Emby_GKE](../labs/Emby_GKE.md).

## Guides associés {#related-guides}

- [Lab pratique : Emby sur GKE Autopilot](../labs/Emby_GKE.md) — déployez-le
  étape par étape, avec les écrans de la console et les commandes à chaque
  étape.
- [Emby sur Google Cloud Run](Emby_CloudRun.md) — la même application sur Cloud
  Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Emby Common — Configuration d'application partagée](Emby_Common.md) — la
  configuration partagée par les deux cibles de déploiement.
