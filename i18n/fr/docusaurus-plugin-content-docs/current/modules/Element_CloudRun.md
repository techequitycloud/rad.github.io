---
title: "Element sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Element sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Element_CloudRun.md @ e69407af sha256:f1579a0dbbc5 -->

# Element sur Google Cloud Run {#element-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Element_CloudRun.png" alt="Element sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Element est le principal client web [Matrix](https://matrix.org/) open source
(AGPLv3) — une application de messagerie et de collaboration auto-hébergée et
chiffrée de bout en bout. Ce module déploie Element sur **Cloud Run v2**
par-dessus la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Element est une **application monopage (SPA) nginx statique** : le navigateur
communique directement avec un serveur domestique Matrix (tel que Synapse ou
Dendrite) via HTTPS, de sorte que le conteneur lui-même ne contient aucun état
côté serveur — pas de base de données, pas de Redis, pas de stockage persistant
et pas de secrets.

Ce guide se concentre sur les services cloud qu'Element utilise et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls et le cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Element sur RAD, et comment cela se compare {#what-element-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'Element sur RAD coûte environ 16,78 $ US par mois.** Un
serveur autogéré est moins cher en espèces, mais vous devez alors gérer
vous-même le système d'exploitation, les correctifs de sécurité et les mises à
niveau. GKE Autopilot convient aux instances d'Element qui doivent rester
opérationnelles en permanence ou s'adapter à travers les pods ; pour le coût le
plus bas, ce module Cloud Run vous offre déjà l'option la moins chère —
consultez le [guide GKE](Element_GKE.md) si vous avez besoin de l'autre. Les
chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de
cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier, une démo, une
activité saisonnière — un projet géré par RAD peut être supprimé et restauré
dans les 30 jours pour une poignée de crédits, de sorte que les 16,78 $ US
deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**,
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **16,78 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour**, environ 90 par mois (environ 9 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de
fichiers et le réseau sont partagés par chaque application du projet, de sorte
qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 0,5 GiB (scaleToZero) | 10,78 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 16,78 $ US** |

### Comment cela se compare {#how-it-compares}

- Les niveaux payants d'Element (Enterprise, Sovereign) sont tarifés par siège
  ou par déploiement sans tarif publié, il n'y a donc rien à citer ici. Element
  est également exceptionnellement léger à auto-héberger, car il s'agit d'une
  application monopage statique sans base de données propre — même le plus
  petit et le moins cher des VPS le sert confortablement, bien en dessous de la
  classe de 2 vCPU à ~24 $/mois dont une application plus lourde a besoin.
- Le coût réel d'exécution de Matrix est presque entièrement celui du
  **serveur domestique** (Synapse ou Dendrite) auquel Element se connecte, qui
  est un déploiement séparé que ce module n'inclut pas.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Element s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à Element dont vous n'avez besoin qu'occasionnellement
— pour étudier, une démo, une activité saisonnière — que de le faire
fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette attente. Contrairement à la suppression d'un seul module, cela ne
  détruit pas Cloud Run ou son réseau un par un — l'ensemble du projet, et tout
  ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.**
  Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de restaurer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Cela coûte **une poignée de crédits (moins de 1 $ US)** au total
  pour une chaîne de déploiement typique de la taille d'Element, contre les 40
  crédits (4,05 $ US) qu'un redéploiement complet coûte.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 16,78 $ US.** Déployez Element, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé.
  Vous ne payez que les frais de module une seule fois, les builds, et les
  heures pendant lesquelles Element était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des études et des démos
  utilisent). Google indique que la plupart des services sont à nouveau
  entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Le seul véritable manque ailleurs ne s'applique pas ici.** Element ne
  conserve aucune donnée propre — pas de base de données, pas de compartiment
  de stockage — il n'y a donc rien à perdre lors de la restauration. Votre
  historique de conversation Matrix se trouve sur le serveur domestique vers
  lequel vous avez pointé Element, et non dans ce déploiement.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run s'adapte déjà à zéro entre les requêtes. L'option ci-dessus ne
s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une
fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de
supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 44 crédits (4,45 $ US), et environ une heure, car RAD
  recrée le projet et les services partagés avant Element. La suppression
  permet d'économiser de l'argent une fois qu'Element resterait inutilisé
  pendant environ **8 jours ou plus** dans votre propre projet (environ 0,56 $
  US par jour), ou environ **14 jours ou plus** dans un projet géré par RAD (3
  crédits par jour).
- **Supprimez tout ce qu'Element utilise.** Element ne contient aucun état
  côté serveur — pas de base de données, pas de stockage de fichiers — donc sa
  suppression arrête immédiatement tous ses propres coûts d'exécution, et il
  n'y a rien qu'il partage avec d'autres applications dans le projet à laisser
  en cours d'exécution.
- **Conservez d'abord vos données.** Element lui-même ne stocke rien à
  sauvegarder ; c'est un client sans état pointé vers un serveur domestique
  Matrix que vous exécutez séparément, donc la suppression du déploiement ne
  perd que sa propre configuration (règles d'ingress, domaines), pas
  l'historique des chats ou les données utilisateur.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour
  vous ; vous entrez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient Element dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  Element pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la
  facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.

---

## 1. Vue d'ensemble {#1-overview}

Element s'exécute comme un conteneur nginx statique sur Cloud Run v2. Le
déploiement relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | SPA statique nginx, 1 vCPU / 512 MiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Build de conteneur | Cloud Build + Artifact Registry | Image personnalisée mince `FROM vectorim/element-web` avec un point d'entrée d'exécution `config.json` |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Secrets | — | **Aucun.** Element ne nécessite aucun secret |
| Base de données | — | **Aucune.** Le serveur domestique Matrix détient tout l'état, pas Element |
| Stockage d'objets | — | **Aucun.** Element est sans état |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Element est sans état.** Tout l'état du chat, les clés de chiffrement et
  les médias résident sur le serveur domestique Matrix et dans le navigateur de
  l'utilisateur. Element lui-même ne stocke rien côté serveur, il n'y a donc
  pas de base de données, de Redis, de compartiment GCS ou de secret Secret
  Manager.
- **Le serveur domestique est une configuration d'exécution.** `homeserver_url` /
  `homeserver_name` sont écrits dans `/app/config.json` par le point d'entrée du
  conteneur à chaque démarrage, de sorte qu'une image peut pointer vers
  n'importe quel serveur domestique sans reconstruction. Les laisser vides
  revient à utiliser le `matrix.org` public.
- **Build personnalisé avec une version épinglée.** `container_image_source = "custom"` construit une
  image mince sur `vectorim/element-web`. `application_version = "latest"` se résout en la balise
  connue et épinglée `v1.11.86` via un ARG de build `ELEMENT_VERSION`
  spécifique à l'application.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Un serveur d'actifs statiques ne coûte rien au repos et
  démarre à froid en moins d'une seconde — les démarrages à froid ne sont pas
  un problème pour Element.
- **Ingress public par défaut.** `ingress_settings = "all"` rend l'interface utilisateur
  client accessible ; Element effectue sa propre connexion au serveur
  domestique. Ajoutez IAP si vous souhaitez une passerelle d'identité Google
  devant l'interface utilisateur.
- **Port 80.** nginx sert la SPA sur le port 80 ; les sondes ciblent
  `/`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Element {#a-cloud-run--the-element-service}

Element s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge de requêtes entre le nombre minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Image de conteneur — Cloud Build et Artifact Registry {#b-container-image--cloud-build--artifact-registry}

L'image Element est construite par Cloud Build à partir d'un Dockerfile mince
qui superpose un point d'entrée générant `config.json` sur `vectorim/element-web`, puis
poussée vers Artifact Registry. `application_version = "latest"` construit le `v1.11.86` épinglé.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le pipeline de build, la mise en
miroir d'images et la politique de rétention.

### C. Réseau et ingress {#c-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité. Comme Element est un serveur d'actifs statiques,
c'est un excellent candidat pour Cloud CDN.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Identity-Aware Proxy (facultatif) {#d-identity-aware-proxy-optional}

Element est livré ouvert par défaut afin que les utilisateurs puissent se
connecter au serveur domestique. Pour restreindre qui peut même charger
l'interface utilisateur client à vos identités Google, activez IAP
(`enable_iap = true`).

- **Console :** Sécurité → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la configuration IAP et l'écran de
consentement OAuth.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneur (accès/erreur nginx) sont acheminés vers Cloud
Logging ; les métriques Cloud Run sont acheminées vers Cloud Monitoring, avec
un test de disponibilité et une alerte de défaillance de test provisionnés
lorsque le point de terminaison est publiquement accessible.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes / Tests de disponibilité.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Element {#3-element-application-behaviour}

- **Génération de la configuration d'exécution.** Le point d'entrée du
  conteneur écrit `/app/config.json` à chaque démarrage à partir de `HOMESERVER_URL` /
  `HOMESERVER_NAME`, puis passe la main à nginx. Changer le serveur domestique est un
  redéploiement avec de nouvelles valeurs d'environnement — pas de
  reconstruction d'image.
- **Pas de base de données, pas de migrations.** Element sert des actifs
  statiques ; il n'y a pas de schéma, pas de job d'initialisation et pas de
  fenêtre de migration au premier démarrage. Le service est prêt dès que nginx
  lie le port 80.
- **La connexion est un flux navigateur-serveur domestique.** Element
  authentifie l'utilisateur directement auprès du serveur domestique Matrix
  configuré ; il n'y a pas de session côté serveur dans le conteneur Cloud Run
  et rien à semer dans Secret Manager.
- **Vérifiez le serveur domestique injecté.** Confirmez que l'environnement de
  la révision en cours correspond à votre serveur domestique prévu :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
  Ouvrez ensuite `$SERVICE_URL` — l'écran de connexion devrait afficher votre
  serveur domestique, et `curl -s "$SERVICE_URL/config.json"` devrait renvoyer le JSON avec votre
  `base_url`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/`, auquel nginx répond immédiatement et sans authentification.
- **Mise à niveau d'Element.** Mettez à jour `application_version` (ou épinglez une
  balise `element-web` plus récente) et redéployez ; une nouvelle image est
  construite et une nouvelle révision est déployée. Comme Element réutilise une
  balise de version à travers les reconstructions, le déclencheur de hachage de
  contenu du build pilote la nouvelle image ; vérifiez le digest de la révision
  déployée si un changement semble obsolète.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Element sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `element` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Element` | Nom lisible par l'homme affiché dans la console. Non personnalisé pour Element dans `variables.tf` — remplacez par exemple par `"Element"` pour un nom d'affichage plus clair. |
| `application_version` | `latest` | Balise d'image Element ; `latest` construit le `v1.11.86` épinglé. Épinglez une balise `element-web` spécifique en production. |
| `homeserver_url` | `""` | URL de base du serveur domestique Matrix écrite dans `config.json`. Vide → `matrix.org`. |
| `homeserver_name` | `""` | Nom du serveur Matrix (identité de délégation) annoncé par Element. Vide → `matrix.org`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image Element mince via Cloud Build. |
| `container_image` | `""` | Remplacez par une URI d'image pré-construite/mise en miroir. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher gen2 est de 512 MiB). |
| `container_port` | `80` | nginx écoute sur le port 80. |
| `min_instance_count` | `0` | **Codé en dur, non réglable.** `element.tf` l'épingle à `0` dans l'appel du module Foundation et la fusion de configuration ; `var.min_instance_count` n'est jamais transféré, donc l'augmenter (par exemple pour éliminer les démarrages à froid) est ignoré silencieusement. La mise à l'échelle à zéro est toujours en vigueur — un serveur statique est gratuit au repos quelle que soit la valeur d'entrée. |
| `max_instance_count` | `3` | Limite supérieure d'autoscaling — véritablement ajustable ; transférée via `var.max_instance_count`. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes (moins chère) — Element ne fait aucun travail en arrière-plan. |
| `execution_environment` | `gen2` | Environnement d'exécution Cloud Run. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — Auth Proxy non monté. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Interface utilisateur publique. Définissez `internal` pour restreindre au VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google pour charger l'interface utilisateur client. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires fusionnés avec les `HOMESERVER_URL` / `HOMESERVER_NAME` injectés. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Element n'en a pas besoin. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Hérité de [App_CloudRun](App_CloudRun.md) et **sans effet pour Element** (rien
à sauvegarder). `backup_schedule`, `backup_retention_days`, `enable_backup_import`,
`backup_source`, `backup_uri`, `backup_format`.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN — utile pour les actifs statiques d'Element. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

Hérité et **non utilisé par Element** (sans état). `create_cloud_storage`,
`storage_buckets` (vide), `enable_nfs` (`false`), `gcs_volumes` (vide),
`manage_storage_kms_iam`, `enable_artifact_registry_cmek`.

### Groupe 12 — Base de données {#group-12--database}

Hérité de [App_CloudRun](App_CloudRun.md) et **inerte** — `Element_Common` définit
`database_type = "NONE"`. Aucune instance Cloud SQL, utilisateur ou mot de passe n'est créé.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Element ne déclare aucun job d'initialisation. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 10 s de délai, 6 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/` 15 s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif (le point de terminaison est public). |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

Hérité de [App_CloudRun](App_CloudRun.md) et **inerte** — une SPA statique n'a
pas de cache ou de file d'attente côté serveur. `enable_redis`, `redis_host`,
`redis_port`, `redis_auth`.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Compartiments Cloud Storage créés (vides pour Element). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (aucun pour Element). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs *et les combinaisons* au moment de la planification —
> IAP sans identités autorisées, un environnement d'exécution `gen1` avec
> des montages NFS/GCS, un `timeout_seconds` hors plage. Une configuration
> invalide échoue à la **planification** avec une erreur claire et nommée
> avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `homeserver_url` / `homeserver_name` | Votre véritable serveur domestique, ou vide pour matrix.org | Élevé | Un serveur domestique erroné ou inaccessible empêche les utilisateurs de se connecter — l'interface utilisateur se charge mais l'authentification échoue. |
| `application_version` | Épinglez une véritable balise `element-web` | Élevé | `latest` n'est pas une balise `element-web` valide ; le module épingle `v1.11.86`, mais un `latest` défini manuellement dans un ARG de build brut échouerait avec `MANIFEST_UNKNOWN`. |
| `ingress_settings` | `all` pour l'interface utilisateur publique | Élevé | `internal` rend l'interface utilisateur client inaccessible depuis les navigateurs extérieurs au VPC. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` avec une image qui n'a pas le point d'entrée `config.json` déploie Element pointé vers le mauvais serveur domestique (ou aucun). |
| `memory_limit` | `512Mi` | Moyen | L'environnement d'exécution gen2 rejette tout ce qui est inférieur à 512 MiB au moment de la planification, quel que soit le mode de facturation. |
| `enable_iap` | Activer pour protéger l'interface utilisateur | Moyen | Sans IAP, toute personne ayant l'URL peut charger le client (elle a toujours besoin des identifiants du serveur domestique pour se connecter). |
| `enable_cdn` | Activer pour les déploiements publics | Faible | Servir des actifs statiques directement depuis Cloud Run manque un gain facile en latence/egress. |
| Entrées de base de données / Redis / Sauvegarde | Laisser par défaut | Faible | Inerte pour Element ; les définir n'a aucun effet. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Element partagée avec la variante GKE est décrite
dans **[Element_Common](Element_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Element sur Cloud Run](../labs/Element_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Element sur GKE Autopilot](Element_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Element Common — Configuration d'application partagée](Element_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md), [Headscale sur Google Cloud Run](Headscale_CloudRun.md) dans la solution **Communications d'équipe sécurisées**.
