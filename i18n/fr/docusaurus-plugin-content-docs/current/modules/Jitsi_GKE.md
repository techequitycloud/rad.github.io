---
title: "Module Jitsi GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Jitsi sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Jitsi_GKE.md @ 1665a43e sha256:28dbc7748da2 -->

# Module Jitsi GKE — Guide de configuration {#jitsi-gke-module--configuration-guide}

Ce guide décrit toutes les variables de configuration disponibles dans le module `Jitsi_GKE`. `Jitsi_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Jitsi_Common`](./Jitsi_Common.md) pour déployer [Jitsi Meet](https://jitsi.org/jitsi-meet/) — une solution de visioconférence open source basée sur un navigateur, sans compte requis pour participer — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Jitsi GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Jitsi** sont décrites en détail ici.

> **Remarque :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

> **GKE uniquement :** Le videobridge de Jitsi transporte tout l'audio et la vidéo sur le **port UDP 10000** et doit annoncer une adresse publique fixe aux navigateurs. Cloud Run ne peut pas accepter l'UDP entrant, Jitsi n'est donc proposé que sur GKE.

---

## Ce que coûte Jitsi Meet sur RAD, et comment cela se compare {#what-jitsi-meet-costs-on-rad-and-how-that-compares}

**Jitsi Meet sur RAD coûte environ 59 $ US par mois dans votre propre projet, plus des frais de module de 110 crédits (11 $ US) une fois par déploiement — sans compte requis pour les appelants et sans frais par participant.** Si vous n'en avez besoin que pour des événements spécifiques plutôt que de manière continue, consultez la section "Mettez-le en pause gratuitement" ci-dessous pour arrêter de payer sans perdre votre configuration. Jitsi n'est livré que sous forme de module GKE sur RAD ; Cloud Run ne peut pas accepter le trafic vidéo UDP entrant dont le videobridge de Jitsi a besoin, il n'y a donc pas de variante Cloud Run.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11,00 $ US) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **59,11 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **63 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la
base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1x vCPU / 2 Gio | 39,68 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 59,11 $ US** |

### Comment cela se compare {#how-it-compares}

- Jitsi Meet lui-même est gratuit et open source sans niveau payant officiel, mais 8x8 — le
  gestionnaire de Jitsi — vend une version hébergée sous sa propre marque ; nous n'avons pas pu obtenir un prix actuel et
  citable au moment de la rédaction, nous n'en citons donc pas ici plutôt que de deviner.
- Le propre pod de Jitsi est modeste (1 vCPU, 2 Gio) mais le videobridge a besoin d'un point de terminaison UDP routable, ce qui est
  la partie qu'un simple VPS gère facilement : un Hetzner CPX22 ou un droplet DigitalOcean 2 vCPU/4 Go (environ
  24 $/mois) est une façon courante pour les gens d'auto-héberger Jitsi aujourd'hui, et un GCP Compute Engine e2-standard-2
  (environ 49 $/mois) le couvre confortablement.
- Ce que RAD ajoute par rapport à un VPS nu : le cluster GKE, le réseau et l'adresse publique fixe dont le
  videobridge a besoin sont provisionnés et câblés pour vous, plutôt que configurés à la main.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Jitsi fonctionne dans un projet géré par RAD pour vous et que vous prévoyez d'y revenir — une pause
entre les cours, un creux saisonnier, ou simplement ne sachant pas encore si vous en aurez besoin le mois
prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression de Jitsi en tant que
module unique, cela ne démantèle pas le cluster GKE, le videobridge, le serveur de fichiers NFS et le réseau un par un — l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de récupérer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 $ US) en temps de build
pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un que RAD gère uniquement pour la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du niveau (100 crédits pour le niveau sandbox que la plupart utilisent conviennent). Google indique que la plupart des services sont
entièrement fonctionnels dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. Jitsi Meet ne conserve aucune donnée de réunion durable propre — les salles sont éphémères — il y a donc peu de choses au-delà de la configuration à perdre en supprimant le projet de toute façon.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli consiste à supprimer
Jitsi purement et simplement et à le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module
  indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression permet d'économiser de l'argent seulement si Jitsi resterait autrement inutilisé
  pendant environ 6 jours ou plus dans votre propre projet (environ 2 jours ou plus dans un projet géré par RAD). Les frais de gestion de cluster GKE et la VM NFS représentent la majeure partie du coût d'exécution ici, donc la suppression de Jitsi seule n'économise que sa propre part si l'un ou l'autre est partagé avec d'autres applications.
- **Conservez les données en premier.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et
  ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket
  que vous conservez) avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie pour la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
  par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section du guide App_GKE | Notes spécifiques à Jitsi |
|---|---|---|
| Projet et identité | Groupe 1 — Projet et identité | Identique. `region` place également l'IP statique du videobridge. |
| Identité de l'application | Groupe 3 — Identité de l'application | `application_version` épingle **les quatre** images ; voir [Groupe 3](#group-3-application-identity). |
| Exécution et mise à l'échelle | Groupe 4 — Exécution et mise à l'échelle | `container_image_source = "prebuilt"`, `container_port = 80` ; voir [Groupe 4](#group-4-runtime--scaling). |
| Variables d'environnement et secrets | Groupe 5 — Variables d'environnement et secrets | Entrées spécifiques à Jitsi `public_url`, `xmpp_domain`, `enable_auth`, `enable_guests`, `timezone` ; voir [Groupe 5](#group-5-environment-variables--secrets). |
| Configuration du backend GKE | Groupe 6 — Configuration du backend GKE | `service_type = "ClusterIP"` ; ajoute `jvb_port` ; voir [Groupe 6](#group-6-gke-backend-configuration). |
| Services supplémentaires | Groupe 11 — Automatisation des charges de travail | prosody, jicofo et jvb sont fournis par `Jitsi Common` ; voir [Groupe 11](#group-11-workload-automation). |
| Stockage — NFS | Groupe 13 — Stockage NFS | Activé par défaut mais inutilisé par Jitsi ; voir [Groupe 13](#group-13-nfs). |
| Stockage — GCS | Groupe 14 — Cloud Storage | Un bucket `data` est créé par défaut mais inutilisé par Jitsi ; voir [Groupe 14](#group-14-cloud-storage). |
| Configuration de la base de données | Groupe 16 — Configuration de la base de données | **Pas de base de données** — moteur fixé à `NONE` ; voir [Groupe 16](#group-16-database). |
| Planification et rétention des sauvegardes | Groupe 17 — Sauvegarde et maintenance | Non applicable (pas de base de données). |
| Scripts SQL personnalisés | Groupe 18 — Scripts SQL personnalisés | Non applicable (pas de base de données). |
| Observabilité et vérifications de santé | Groupe 10 — Observabilité | `startup_probe_config` / `health_check_config` **sont** les sondes web déployées ; voir [Groupe 10](#group-10-observability--health). |
| Cloud Armor WAF | Groupe 21 — Cloud Armor et CDN | Protège uniquement le point d'entrée web — pas l'équilibreur de charge UDP jvb. |
| Proxy sensible à l'identité | Groupe 20 — Proxy sensible à l'identité | Protège uniquement le point d'entrée web. |
| Autorisation binaire | Groupe 12 — CI/CD | Identique. |
| Contrôles de service VPC | Groupe 22 — Contrôles de service VPC et journalisation d'audit | Identique. |
| Pilote CSI du magasin de secrets | Groupe 5 — Variables d'environnement et secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | Groupe 19 — Accès et réseau | Web via la passerelle ; média via un équilibreur de charge UDP séparé. |
| Domaine personnalisé et IP statique | Groupe 19 — Accès et réseau | Définissez `public_url` pour correspondre ; voir [Groupe 19](#group-19-custom-domain--networking). |
| Déclencheurs Cloud Build | Groupe 12 — CI/CD | Identique. |
| Pipeline Cloud Deploy | Groupe 12 — CI/CD | Identique. |
| Mise en miroir des images | Groupe 4 — Exécution et mise à l'échelle | S'applique à l'image web. |
| Budgets d'interruption de pod | Groupe 9 — Fiabilité | Activé par défaut pour la charge de travail web. |
| Cache Redis | Groupe 15 — Cache Redis | Non utilisé par aucun composant Jitsi. |

---

## Comment Jitsi GKE est lié à App GKE {#how-jitsi-gke-relates-to-app-gke}

`Jitsi GKE` transmet ses variables à `App GKE` et ajoute un sous-module `Jitsi Common` qui fournit la configuration spécifique à Jitsi. Il crée également une ressource propre. Les principaux effets sont les suivants :

1.  **Quatre images, une balise.** `jitsi/web` est le conteneur principal ; `jitsi/prosody`, `jitsi/jicofo` et `jitsi/jvb` sont fournis en tant que `additional_services`. Les quatre utilisent la balise `application_version` (par défaut `stable-11031`). Le mélange de versions n'est pas pris en charge — jicofo et jvb parlent un protocole versionné à prosody — et aucune des images n'a de balise `latest`.
2.  **Pas de build, pas de base de données.** `container_image_source = "prebuilt"` : les images amont sont entièrement configurées via des variables d'environnement, il n'y a donc pas de Dockerfile. `database_type` est fixé à `NONE` par `Jitsi Common` ; aucune instance Cloud SQL, utilisateur de base de données ou job d'initialisation n'est créé.
3.  **Une adresse réservée pour le videobridge.** L'enveloppe crée une adresse `google_compute_address` externe régionale nommée `<service-name>-jvb` et la transmet à jvb en tant que `JVB_ADVERTISE_IPS` (et `DOCKER_HOST_ADDRESS`). jvb transmet cette adresse aux navigateurs dans les candidats ICE, elle doit donc être connue avant le démarrage de jvb — une IP de LoadBalancer éphémère n'est connue qu'après. `JVB_DISABLE_STUN = "true"` car l'adresse annoncée est déjà publique.
4.  **Média sur son propre LoadBalancer UDP.** Le service de jvb est un `LoadBalancer` sur **UDP 10000** épinglé à cette adresse. GCP ne permet pas à un service LoadBalancer de mélanger TCP et UDP, donc jvb ne peut pas partager le service web. Il n'y a pas de repli TCP dans cette build.
5.  **Web derrière la passerelle.** `service_type = "ClusterIP"` ; le navigateur atteint `jitsi/web` sur le port 80 via la passerelle L7, qui termine le TLS. Le conteneur est informé de ne pas faire de TLS lui-même (`ENABLE_LETSENCRYPT = 0`, `DISABLE_HTTPS = 1`).
6.  **prosody est trouvé par le nom du service.** Le docker-compose amont atteint prosody via un alias réseau. Kubernetes n'en a pas, donc l'enveloppe calcule le nom du service prosody (`<service-name>-prosody`) à partir du même module `deployment_id` que `App GKE` utilise et le définit comme `XMPP_SERVER`.
7.  **Mots de passe de composants générés.** `Jitsi Common` génère `JICOFO_AUTH_PASSWORD` et `JVB_AUTH_PASSWORD`, les stocke dans Secret Manager (réplication régionale, gérée par l'utilisateur), et les trois conteneurs back-end les lisent à partir du même Secret Kubernetes, de sorte que prosody provisionne les comptes avec exactement les mots de passe que les composants utilisent.
8.  **Les sondes atteignent le conteneur déployé.** Contrairement à certaines enveloppes, `Jitsi GKE` transmet `startup_probe_config` et `health_check_config` à `Jitsi Common` en tant que `startup_probe`/`liveness_probe` du conteneur web, de sorte que leur modification modifie les sondes déployées. Les conteneurs back-end n'ont pas de sondes.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(requis)* | Projet GCP dans lequel `Services_GCP` a été déployé. |
| `tenant_id` | `"demo"` | 1 à 7 caractères alphanumériques minuscules ajoutés aux noms de ressources. |
| `region` | `"us-central1"` | Région de repli lorsque la découverte de sous-réseau VPC ne peut pas en déterminer une. La région découverte (ou de repli) est également l'endroit où l'IP statique jvb et les deux répliques Secret Manager sont créées. |

---

## Groupe 2 : Environnement de déploiement {#group-2-deployment-environment}

Identique à `App_GKE` : `support_users` (`[]`) reçoivent les alertes de surveillance ; `resource_labels` (`{}`) sont appliqués à chaque ressource.

---

## Groupe 3 : Identité de l'application {#group-3-application-identity}

| Variable | Valeur par défaut Jitsi GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"jitsi"` | `"gkeapp"` | Nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Jitsi Meet"` | `"App GKE Application"` | Affiché dans l'interface utilisateur de la plateforme. Peut être modifié librement. |
| `application_description` | `"Jitsi Meet — open-source video conferencing: browser-based meetings with no account required."` | — | Libellé descriptif. |
| `application_version` | `"stable-11031"` | `"1.0.0"` | Balise appliquée à **toutes les quatre** images. Ne la modifiez que pour une autre `stable-NNNN` publiée qui existe pour web, prosody, jicofo et jvb. |

---

## Groupe 4 : Exécution et mise à l'échelle {#group-4-runtime--scaling}

| Variable | Valeur par défaut Jitsi GKE | Notes |
|---|---|---|
| `container_image_source` | `"prebuilt"` | Conservez `"prebuilt"`. Jitsi ne fournit pas de Dockerfile ; `"custom"` rendrait une étape Cloud Build sans Dockerfile à construire. |
| `container_image` | `"jitsi/web"` | L'image web ; la balise provient de `application_version`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image web dans Artifact Registry. |
| `container_port` | `80` | Fixé par `Jitsi Common` — `jitsi/web` sert du HTTP simple sur le port 80. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | S'applique uniquement au conteneur **web**, et seules les limites sont transmises. Les conteneurs back-end ont des limites fixes : prosody `1000m`/`1Gi`, jicofo `1000m`/`2Gi`, jvb `1000m`/`2Gi`. |
| `min_instance_count` | `1` | Répliques web minimales. |
| `max_instance_count` | `3` | Répliques web maximales. prosody, jicofo et jvb sont fixés à **une réplique chacun** et ne sont pas mis à l'échelle par ces variables. |
| `enable_cloudsql_volume` | `false` | Pas de base de données. Le fait de le définir `true` est rejeté au moment de la planification tandis que `database_type = "NONE"`. |

Les variables d'exécution restantes (`deploy_application`, `container_build_config`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables spécifiques à Jitsi sont transmises à `Jitsi Common` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `public_url` | `""` | URL publique utilisée par les navigateurs, par exemple `"https://meet.example.com"`. Définie comme `PUBLIC_URL` sur le web et prosody et écrite dans la configuration servie par l'application web — une mauvaise valeur donne une page qui se charge mais ne peut pas se connecter. **Non dérivée automatiquement.** |
| `xmpp_domain` | `"meet.jitsi"` | Racine de la famille de domaines XMPP internes. Les sous-domaines `auth.`, `guest.`, `muc.`, `internal-muc.` et `recorder.` en sont dérivés. Ce sont les hôtes virtuels de prosody, jamais résolus dans le DNS public. Les quatre conteneurs doivent être d'accord — laissez la valeur par défaut à moins que vous ne sachiez pourquoi vous la modifiez. |
| `enable_auth` | `false` | `ENABLE_AUTH` : exige une authentification pour **créer** une salle. |
| `enable_guests` | `true` | `ENABLE_GUESTS` : permet aux participants non authentifiés de rejoindre les salles créées par un utilisateur authentifié. |
| `timezone` | `"UTC"` | `TZ` sur chaque conteneur. |

**Variables d'environnement définies par le module sur `jitsi/web` :**

| Variable | Valeur |
|---|---|
| `PUBLIC_URL` | `var.public_url` |
| `XMPP_DOMAIN`, `XMPP_AUTH_DOMAIN`, `XMPP_GUEST_DOMAIN`, `XMPP_MUC_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_RECORDER_DOMAIN` | Dérivé de `xmpp_domain` |
| `XMPP_SERVER` | `<service-name>-prosody` |
| `XMPP_BOSH_URL_BASE` | `http://<service-name>-prosody:5280` |
| `XMPP_WEBSOCKET` | `/xmpp-websocket` (un chemin sur l'origine publique, proxifié par le web) |
| `ENABLE_AUTH`, `ENABLE_GUESTS` | `"1"`/`"0"` des variables ci-dessus |
| `ENABLE_LETSENCRYPT` | `"0"` |
| `DISABLE_HTTPS` | `"1"` |

Les entrées `environment_variables` sont fusionnées **sur** celles-ci sur le conteneur web (elles n'atteignent pas prosody, jicofo ou jvb). `secret_environment_variables` s'ajoute aux deux mots de passe de composants générés.

**Secrets créés par `Jitsi Common` :**

| Secret | Variable d'environnement | Lu par |
|---|---|---|
| `secret-<prefix>-jitsi-jicofo-auth` | `JICOFO_AUTH_PASSWORD` | prosody, jicofo |
| `secret-<prefix>-jitsi-jvb-auth` | `JVB_AUTH_PASSWORD` | prosody, jvb |

Les deux sont des valeurs aléatoires de 32 caractères sans caractères spéciaux, répliquées uniquement dans la région de déploiement (`user_managed`), car la politique d'emplacement de dossier sur les projets gérés par RAD refuse les secrets `global`.

Les variables restantes (`protect_sensitive_environment_variables`, `secret_propagation_delay`, `secret_rotation_period`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Configuration du backend GKE {#group-6-gke-backend-configuration}

| Variable | Valeur par défaut Jitsi GKE | Notes |
|---|---|---|
| `service_type` | `"ClusterIP"` | Le service web. La passerelle a déjà une adresse externe ; un `LoadBalancer` ici alloue une **deuxième** IP externe pour la même surface HTTP, ce qui, sur un projet soumis à des quotas, peut laisser les équilibreurs de charge web et jvb bloqués en `<pending>`. |
| `service_port` | `80` | Port sur le service web. |
| `jvb_port` | `10000` | Port UDP du service videobridge et `JVB_PORT`. Le service jvb est toujours `LoadBalancer` et toujours UDP. |
| `session_affinity` | `"ClientIP"` | Affinité du service web. |
| `workload_type` | `"Deployment"` | La charge de travail web. |
| `termination_grace_period_seconds` | `30` | — |
| `deployment_strategy` | `null` | Déclaré mais non référencé — sans effet. |

`namespace_name` et `enable_network_segmentation` se comportent comme décrit dans [App_GKE](./App_GKE.md#group-6--gke-backend-config).

---

## Groupe 7 : Charges de travail avec état {#group-7-stateful-workloads}

Identique à `App_GKE`. Jitsi ne stocke rien sur disque, donc `stateful_pvc_enabled` (par défaut `false`) devrait rester désactivé.

---

## Groupe 9 : Politiques de fiabilité {#group-9-reliability-policies}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Crée un PodDisruptionBudget pour la charge de travail web. |
| `pdb_min_available` | `"1"` | Avec une seule réplique web, cela signifie que les évictions volontaires (mises à niveau de nœuds) attendent un remplacement. |

---

## Groupe 10 : Observabilité et santé {#group-10-observability--health}

`startup_probe_config` et `health_check_config` sont transmis à `Jitsi Common` en tant que sondes de démarrage et de vivacité du conteneur **web**, ce sont donc les sondes qui s'exécutent réellement.

| Sonde | Chemin | Délai initial | Délai d'expiration | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage (`startup_probe_config`) | `/` (HTTP) | 60s | 5s | 10s | 3 |
| Vivacité (`health_check_config`) | `/` (HTTP) | 60s | 5s | 30s | 3 |

prosody, jicofo et jvb n'ont pas de sondes, donc un conteneur back-end qui fonctionne mais n'est pas connecté (par exemple jvb refusé par prosody) n'est pas redémarré automatiquement — vérifiez leurs journaux.

`uptime_check_config` est par défaut `{ enabled = false, path = "/" }`. `alert_policies` se comporte comme décrit dans [App_GKE](./App_GKE.md#group-10--observability).

---

## Groupe 11 : Automatisation des charges de travail {#group-11-workload-automation}

`Jitsi Common` fournit toujours trois `additional_services` ; vos propres entrées `additional_services` leur sont **ajoutées**.

| Service | Image | Type de service | Ports | Limites |
|---|---|---|---|---|
| `prosody` | `jitsi/prosody:<version>` | ClusterIP | TCP 5222, 5280 (`bosh`), 5347 (`xmpp-component`) | `1000m` / `1Gi` |
| `jicofo` | `jitsi/jicofo:<version>` | ClusterIP | TCP 8888 (requis pour construire un service ; rien ne s'y connecte) | `1000m` / `2Gi` |
| `jvb` | `jitsi/jvb:<version>` | **LoadBalancer** sur l'IP réservée | **UDP** `jvb_port` (10000) | `1000m` / `2Gi` |

Chacun exécute une réplique. jicofo rejoint le MUC `jvbbrewery` sur le domaine MUC interne pour découvrir le pont ; prosody provisionne les comptes `focus` (jicofo) et `jvb`.

`initialization_jobs` est vide (Jitsi n'en a pas besoin) et `cron_jobs` se comporte comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Groupe 12 : CI/CD et intégration GitHub {#group-12-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd). Variables : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.

---

## Groupe 13 : NFS {#group-13-nfs}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | Monte le partage NFS `Services_GCP` dans le pod web. Aucun composant Jitsi ne le lit ou ne l'écrit. |
| `nfs_mount_path` | `"/mnt/nfs"` | — |

`nfs_volume_name`, `nfs_instance_name` et `nfs_instance_base_name` se comportent comme décrit dans [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Groupe 14 : Cloud Storage {#group-14-cloud-storage}

`create_cloud_storage = true` avec la valeur par défaut `storage_buckets = [{ name_suffix = "data" }]` crée un bucket. Jitsi ne l'utilise pas, et `Jitsi Common` ne déclare aucun bucket propre. Les variables restantes de stockage et de rétention d'images se comportent comme décrit dans [App_GKE](./App_GKE.md#group-14--cloud-storage).

---

## Groupe 15 : Redis {#group-15-redis}

`enable_redis` (par défaut `false`), `redis_host`, `redis_port`, `redis_auth` se comportent comme dans [App_GKE](./App_GKE.md#group-15--redis-cache). Aucun composant Jitsi n'utilise Redis.

---

## Groupe 16 : Base de données {#group-16-database}

Jitsi n'a pas de base de données. `Jitsi Common` définit `database_type = "NONE"` dans la configuration de l'application, et c'est ce que `App GKE` provisionne indépendamment du propre `database_type` de l'enveloppe (par défaut `"NONE"`), qui ne fait qu'alimenter les gardes de validation au moment de la planification. `application_database_name`/`application_database_user` (`"jitsi"`), `database_password_length`, les variables d'extension PostgreSQL/MySQL, `enable_auto_password_rotation` et les alias `db_*_env_var_name` n'ont aucun effet.

---

## Groupes 17-18 : Sauvegarde et maintenance, SQL personnalisé {#groups-1718-backup--maintenance-custom-sql}

Non applicable. `enable_backup_import` et `enable_custom_sql_scripts` sont rejetés au moment de la planification tandis que `database_type = "NONE"`.

---

## Groupe 19 : Domaine personnalisé et réseau {#group-19-custom-domain--networking}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-19--access--networking).

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la passerelle pour le service web. |
| `application_domains` | `[]` | Vide utilise un nom d'hôte `nip.io` gratuit dérivé de l'IP réservée de la passerelle, avec un certificat géré par Google. |
| `reserve_static_ip` | `true` | IP statique globale pour la passerelle (séparée de l'IP régionale jvb). |

> **Définissez `public_url` pour qu'il corresponde.** Lors de la diffusion sur un domaine personnalisé, définissez `public_url = "https://<your-domain>"`. Les navigateurs n'accordent l'accès à la caméra et au microphone que sur des origines sécurisées (HTTPS), testez donc les appels via l'URL HTTPS.

---

## Groupes 20-22 : IAP, Cloud Armor, Contrôles de service VPC {#groups-2022-iap-cloud-armor-vpc-service-controls}

Identique à `App_GKE` — voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy). IAP et Cloud Armor s'appliquent à la passerelle (le point d'entrée web). Ils ne se trouvent **pas** devant l'équilibreur de charge UDP jvb, qui doit accepter les médias du réseau de chaque participant.

---

## Exploration du déploiement {#exploring-the-deployment}

### Console Google Cloud {#google-cloud-console}

**Charges de travail :** **Kubernetes Engine → Charges de travail**, filtré sur l'espace de noms du déploiement, affiche quatre déploiements — la charge de travail web plus `<service-name>-prosody`, `<service-name>-jicofo` et `<service-name>-jvb`.

**Services :** **Kubernetes Engine → Passerelles, services et Ingress** affiche le service web (ClusterIP), les services prosody et jicofo (ClusterIP) et le service jvb (`LoadBalancer`, UDP).

**Adresses IP :** **Réseau VPC → Adresses IP** liste l'adresse régionale `*-jvb` et l'adresse globale de la passerelle.

**Secrets :** **Sécurité → Secret Manager** liste les secrets `*-jicofo-auth` et `*-jvb-auth`.

### gcloud CLI et kubectl {#gcloud-cli-and-kubectl}

```bash
# Cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME --region=REGION --project=PROJECT_ID

# All four workloads and their Services
kubectl get deploy,pods,svc -n NAMESPACE

# The videobridge's reserved address and its UDP forwarding rule
gcloud compute addresses list --project=PROJECT_ID --filter="name~jvb"
gcloud compute forwarding-rules list --project=PROJECT_ID --filter="IPProtocol=UDP"

# jicofo has authenticated to prosody and found the bridge
kubectl logs -n NAMESPACE deploy/SERVICE_NAME-jicofo | grep -E "authenticated|addJvbAddress"

# jvb advertises the public address (StaticMappingCandidateHarvester ... mask=<public-ip>)
kubectl logs -n NAMESPACE deploy/SERVICE_NAME-jvb | grep StaticMapping

# The web front end
curl -s -o /dev/null -w "%{http_code}\n" SERVICE_URL/
```

---

## Sorties du module {#module-outputs}

`Jitsi GKE` expose les sorties standard `App_GKE`. Celles qui sont pertinentes pour Jitsi :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes web (également le préfixe des services prosody/jicofo/jvb) |
| `service_url` | URL du point d'entrée web (l'URL `nip.io` de la passerelle lorsqu'aucun domaine personnalisé n'est défini) |
| `service_external_ip` | IP externe de l'équilibreur de charge (si l'IP statique est réservée) |
| `namespace` | Espace de noms Kubernetes |
| `deployment_id` / `resource_prefix` | Identifiants de nommage |
| `storage_buckets` | Buckets GCS créés |
| `container_image` | Image du conteneur web |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster était accessible et que les ressources Kubernetes étaient déployées |

Les sorties de la base de données sont vides. Il n'y a pas de sortie pour l'adresse jvb — lisez-la à partir du service jvb ou de l'adresse de calcul `*-jvb`.

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, violation de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable / condition | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(requis)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| UDP 10000 vers l'IP jvb bloqué | — | **Critique** | Les appels rejoignent et listent les participants mais ne transportent ni audio ni vidéo. Il n'y a pas de repli TCP. Vérifiez les réseaux clients et tout pare-feu devant eux. |
| `application_version` | `"stable-11031"` | **Élevé** | Les quatre images prennent cette balise. Une balise manquante sur une image échoue le pull de ce pod ; les versions incompatibles entre les composants ne sont pas prises en charge. |
| `public_url` | `""` | **Élevé** | Écrit dans la configuration servie. Une valeur qui ne correspond pas à l'URL que les utilisateurs consultent donne une page qui se charge mais ne peut pas se connecter. |
| `xmpp_domain` | `"meet.jitsi"` | **Élevé** | Chaque conteneur dérive ses hôtes virtuels XMPP de celui-ci ; le modifier est rarement nécessaire et une incompatibilité empêche les composants de se lier. |
| `service_type` | `"ClusterIP"` | **Moyen** | `"LoadBalancer"` ajoute une deuxième IP externe pour la surface web et peut épuiser le quota d'adresses externes du projet, laissant l'équilibreur de charge jvb `<pending>`. |
| `jvb_port` | `10000` | **Élevé** | Le modifier modifie le service et `JVB_PORT` ensemble ; toute liste blanche côté client doit également changer. |
| `container_image_source` | `"prebuilt"` | **Élevé** | `"custom"` n'a pas de Dockerfile à construire ; la construction échoue. |
| `enable_auth` | `false` | **Moyen** | Avec l'authentification désactivée, toute personne pouvant atteindre l'URL peut créer des salles. |
| `enable_cloudsql_volume` | `false` | **Faible** | `true` est rejeté au moment de la planification (pas de base de données). |
| `enable_nfs` / `create_cloud_storage` | `true` / `true` | **Faible** | Provisionné mais inutilisé par Jitsi — un coût faible et évitable. |
| `max_instance_count` | `3` | **Faible** | Met à l'échelle uniquement le niveau web ; il n'ajoute pas de capacité de videobridge. |
| `enable_pod_disruption_budget` | `true` | **Faible** | Avec une seule réplique web, les vidanges de nœuds attendent un pod de remplacement. |
| Premier apply d'un nouveau déploiement (OpenTofu exécuté directement) | — | **Moyen** | Le README `Jitsi_Common` enregistre un échec de planification (`local.additional_services will be known only after apply`) tant que l'adresse jvb n'est pas encore dans l'état ; il a été résolu par `tofu apply -target=google_compute_address.jvb`, puis `tofu apply`. |

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Jitsi sur GKE Autopilot](../labs/Jitsi_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Jitsi Common — Configuration d'application partagée](Jitsi_Common.md) — la configuration spécifique à Jitsi sur laquelle ce module s'appuie.
