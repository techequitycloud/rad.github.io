---
title: "Kopia sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Kopia sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kopia_GKE.md @ e69407af sha256:04073d31d91d -->

# Kopia sur GKE Autopilot {#kopia-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kopia_GKE.png" alt="Kopia sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kopia est un outil de sauvegarde open source rapide et sécurisé, doté d'un
chiffrement côté client, d'une compression et d'une déduplication. Ce module
exécute Kopia en **mode serveur de dépôt** sur **GKE Autopilot** : un serveur
unique toujours adressable auquel les clients CLI `kopia` distants se connectent
pour pousser/tirer des instantanés chiffrés, sauvegardés nativement par un
bucket Cloud Storage — sur la base de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Kopia utilise et sur la façon
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à chaque application GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls et le cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

**Il n'y a pas de `Kopia_CloudRun`.** Le protocole d'instantané client-serveur de Kopia est
exclusivement gRPC, qui n'obtient du vrai HTTP/2 que via le TLS+ALPN de Kopia
lui-même — le GFE de Cloud Run termine toujours le HTTPS public à sa propre
périphérie et ne peut jamais faire passer un flux TLS terminé par un conteneur,
de sorte qu'une variante Cloud Run (construite, déployée et testée en direct) a
échoué à chaque session d'instantané réelle. Voir [Kopia_Common](Kopia_Common.md)
pour le compte rendu complet et confirmé par la source.

---

## Ce que Kopia coûte sur RAD, et comment cela se compare {#what-kopia-costs-on-rad-and-how-that-compares}

**Le module Kopia sur GKE Autopilot de RAD coûte environ 42 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).** Kopia lui-même est gratuit et open source, sans base de données — il stocke les instantanés chiffrés et dédupliqués nativement dans Cloud Storage, il n'y a donc pas de ligne Cloud SQL dans le tableau ci-dessous. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 42 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **42 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2010 par mois (environ 201 $ US au prix de la recharge, 161 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, de sorte qu'une
deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 1 vCPU / 1 Gio | 36,08 $ US |
| Cloud NAT et réseau | 5,00 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ US |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 42 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun fournisseur ne vend de Kopia SaaS hébergé.** Kopia est un outil de
  sauvegarde client-serveur vers lequel vous pointez vos propres clients `kopia` ;
  la comparaison commerciale la plus proche est un service de stockage de
  sauvegarde géré (par exemple Backblaze B2), qui facture le stockage, et non un
  serveur de dépôt en cours d'exécution, ce n'est donc pas une comparaison
  équivalente.
- **Le serveur de Kopia lui-même est léger** (1 vCPU/1 Gio) — un petit VPS
  autogéré bien en dessous de la classe de comparaison habituelle de 2 vCPU/4
  Go, 24 $/mois peut exécuter `kopia server` directement, plus votre propre temps pour
  le TLS, les mises à niveau et son exposition en toute sécurité aux clients
  distants. Un pod GKE supporte le coût de base du cluster en plus de ce dont
  Kopia lui-même a besoin.
- La valeur de RAD ici est moins une question de prix en espèces que de ne pas
  avoir à exécuter et à patcher le serveur de dépôt vous-même : Secret Manager
  détient ses identifiants, et le bucket Cloud Storage dans lequel il écrit
  hérite des conventions de sauvegarde et de surveillance de RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Kopia s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
tout le projet et le restaurer dans les 30 jours pour presque rien.** Cela
convient bien mieux à Kopia dont vous n'avez besoin qu'occasionnellement — un
projet de cours, une démo, une évaluation de courte durée — que de l'exécuter
en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime
  pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours.
  Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
  attend. Contrairement à la suppression d'un module, cela ne détruit pas les
  calculs propres à Kopia un par un — tout le projet, et tout ce qu'il contient,
  s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans
  les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à
  Google de récupérer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que
  tout est revenu. Comme rien n'a été détruit individuellement, cette mise à
  jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas
  une reconstruction, et une mise à jour ne facture jamais les frais de module
  à nouveau. Pour Kopia derrière un petit Services_GCP et Project_GCP, c'est
  **une poignée de crédits (moins de 1 $ US)** au total, contre les 80 crédits
  que coûte un redéploiement complet.
- **Ce dont cela a besoin.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations d'étude et de
  démo conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un vrai manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  nocturnes de Kopia sont écrites dans un bucket à l'intérieur du projet, et ce
  bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage,
  il est donc très probable qu'il disparaisse dès que vous supprimez le projet
  — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez
  personnalisé Kopia et que vous souhaitez conserver ce travail, copiez une
  sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de
  supprimer, comme pour le flux de redéploiement ci-dessous. Pour une
  installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

GKE maintient au moins un pod en cours d'exécution, il ne se met donc jamais à
l'échelle à zéro de lui-même. L'option ci-dessus ne s'applique qu'à un projet
géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le
déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 80 crédits (8,00 $ US), car RAD recrée le projet et les
  services partagés avant Kopia. La suppression ne permet d'économiser de
  l'argent que si Kopia devait rester inutilisé pendant environ six jours ou
  plus, à la fois dans votre propre projet (environ 1,40 $ US par jour) et dans
  un projet géré par RAD (67 crédits par jour).
- **Supprimer tout ce que Kopia utilise.** La majeure partie du coût
  d'exécution ici est le calcul lui-même et, sur GKE, les frais de gestion de
  cluster une fois que ce projet exécute plus d'un cluster — donc la
  suppression de Kopia alors que quelque chose d'autre partage le projet et son
  cluster n'économise que le pod propre à Kopia.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez
  la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session Kopia
  pour une classe. Chaque participant obtient Kopia dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places à
  l'avance, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session, et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  Kopia pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la
  facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin de l'engagement, le
  partenaire transfère le projet, et les déploiements deviennent la propriété
  du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais RAD et l'estimation quotidienne de 67 crédits de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets
Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Kopia s'exécute comme une charge de travail GKE Autopilot à pod unique avec son
dépôt résidant nativement dans Cloud Storage — pas de base de données, pas de
volume de données monté sur le système de fichiers pour les sauvegardes
elles-mêmes :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de serveur Go, 1 vCPU / 1 Gio par défaut ; un seul réplica de déploiement |
| Stockage de dépôt | Cloud Storage (API GCS native, pas un montage) | Chaque instantané jamais écrit, sous un préfixe d'objet `repository/` |
| Persistance du certificat TLS | Cloud Storage (montage GCS FUSE à `/var/lib/kopia`) | Même bucket, préfixe `tls/` — cert/clé auto-signé, généré une fois |
| Secrets | Secret Manager | Deux secrets indépendants : `ADMIN_PASSWORD` (connexion) et `REPO_PASSWORD` (clé de chiffrement du dépôt) |
| Ingress | LoadBalancer / Cloud Load Balancing | Externe par défaut (les clients distants doivent y accéder) ; passthrough TCP L4 nu — Kopia termine son propre TLS |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de montage de système de fichiers de plan de
  données.** Le dépôt de Kopia est écrit directement via le client API GCS
  natif de Kopia (authentifié par ADC) — le bucket n'est pas monté comme un
  système de fichiers pour les données de sauvegarde. `database_type = "NONE"`.
- **Un bucket, deux rôles.** Le même bucket `storage` est également monté en FUSE
  à `/var/lib/kopia` uniquement pour persister le certificat TLS auto-signé lors des
  redémarrages (préfixe `tls/` — ne rentre jamais en collision avec `repository/`).
- **Kopia termine son propre TLS.** Requis car le service `LoadBalancer` L4 simple de
  GKE n'a pas de périphérie de terminaison HTTP propre (contrairement au GFE de
  Cloud Run). Généré une fois, au premier démarrage ; chaque démarrage ultérieur
  réutilise le même certificat persistant (Kopia refuse de régénérer un
  certificat existant). L'empreinte SHA256 dont chaque client a besoin est
  imprimée une fois, dans les journaux, au moment de la génération.
- **Deux secrets indépendants, non interchangeables.** `ADMIN_PASSWORD` gère l'interface
  utilisateur Web/API de contrôle et peut être renouvelé en toute sécurité.
  `REPO_PASSWORD` est la clé de chiffrement de contenu propre au dépôt, définie une fois
  lors du premier déploiement — la faire pivoter indépendamment du contenu réel
  du dépôt orpheline en permanence chaque instantané existant.
- **Une session client réelle nécessite plus qu'une authentification HTTP
  Basic.** Le point d'entrée provisionne un utilisateur stocké dans le dépôt
  (`<ADMIN_USERNAME>@kopia`) avec les ACL activées à chaque démarrage — requis pour une session
  d'instantané gRPC réelle, que la couche `ADMIN_PASSWORD` seule n'autorise pas.
- **Port `51515`, LoadBalancer par défaut.** Le port de serveur natif de Kopia
  est fixé par `Kopia_Common` ; `service_type` par défaut à `LoadBalancer` puisque
  l'accessibilité externe depuis les clients distants est le but entier de ce
  module.
- **Serveur unique, sûr pour la mise à l'échelle à zéro.** `max_instance_count` doit rester
  `1` (la maintenance du dépôt suppose une propriété de serveur unique) ;
  `min_instance_count = 0` est sûr car le dépôt réside dans Cloud Storage, et non un volume local
  à l'instance.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kopia {#a-gke-autopilot--the-kopia-workload}

Kopia s'exécute comme un pod unique (Déploiement par défaut ; StatefulSet est
disponible mais non nécessaire — voir §4).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Kopia pour voir le pod et les événements.
- **CLI :**
  ```bash
  kubectl get deployment,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment fonctionnent la planification
Autopilot et Workload Identity.

### B. Cloud Storage — le dépôt (pas de Cloud SQL) {#b-cloud-storage--the-repository-no-cloud-sql}

Il n'y a **pas d'instance Cloud SQL** — `database_type = "NONE"`. Les données du dépôt de Kopia
sont écrites directement dans le bucket `storage` via le client API GCS natif de
Kopia, sous le préfixe d'objet `repository/` :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls -r gs://<storage-bucket>/repository/ | head
```

Le même bucket est également monté en FUSE à `/var/lib/kopia` uniquement pour persister
le certificat TLS auto-signé sous un préfixe `tls/` séparé (voir §D) — les deux
ne se chevauchent jamais.

### C. Secret Manager — deux secrets indépendants {#c-secret-manager--two-independent-secrets}

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~repo-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

`ADMIN_PASSWORD` gère l'interface utilisateur Web/API de contrôle ; `REPO_PASSWORD` est la clé de
chiffrement de contenu propre au dépôt et l'identifiant avec lequel un client
réel se connecte. Voir [Kopia_Common §2](Kopia_Common.md#2-two-independent-secrets-in-secret-manager)
pour tous les détails sur les raisons pour lesquelles ils ne sont pas
interchangeables.

### D. Certificat TLS — auto-signé, persistant {#d-tls-certificate--self-signed-persisted}

```bash
# From the pod's first-boot logs (fingerprint prints once, at generation time):
kubectl logs <pod> -n "$NAMESPACE" -c kopia | grep -A2 -i fingerprint

# Recompute at any time (GKE gives real shell access, unlike Cloud Run):
kubectl exec <pod> -n "$NAMESPACE" -c kopia -- \
  openssl x509 -in /var/lib/kopia/tls/cert.pem -noout -fingerprint -sha256
```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est un service **LoadBalancer**, externe et
accessible depuis les clients CLI `kopia` distants dès la sortie de la boîte. Il
s'agit d'un **passthrough TCP L4 nu** — pas de périphérie de terminaison HTTP
— de sorte que le TLS de Kopia atteint le client de bout en bout.

```bash
kubectl get svc -n "$NAMESPACE"    # confirm the external port -> 51515 mapping
gcloud compute addresses list --project "$PROJECT"
```

> **Le port de service externe est par défaut `80`, pas `51515`.** `Kopia_GKE`
> n'expose pas la variable `App_GKE` de `service_port`, il s'agit donc toujours de la
> valeur par défaut `App_GKE` (`80`) ; le `target_port` du service est le vrai port
> de Kopia (`51515`). Puisqu'il s'agit d'un passthrough TCP nu, le TLS de Kopia
> se termine toujours correctement de bout en bout — mais un client doit se
> connecter explicitement à `https://<external-ip>:80` (`https://` seul implique le port 443, qui
> n'est pas ouvert). Confirmez toujours le mappage réel avec `kubectl get svc` avant de
> connecter un client.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Le stdout/stderr du pod est acheminé vers Cloud Logging ; les métriques GKE
sont acheminées vers Cloud Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

Un `uptime_check_config` est disponible mais **désactivé par défaut** — s'il est activé,
sachez qu'il émet une vérification HTTP, et Kopia n'a pas de point de terminaison
HTTP non authentifié à cibler, il échouera donc continuellement.

---

## 3. Comportement de l'application Kopia {#3-kopia-application-behaviour}

- **Connexion ou création de dépôt à chaque démarrage.** Le point d'entrée
  exécute `kopia repository connect gcs --bucket=... --prefix=repository/`, en revenant à `kopia repository create gcs ...` si le dépôt n'existe pas encore. Cette
  logique idempotente remplace entièrement ce qu'un job d'initialisation d'une
  application de base de données ferait autrement — il n'y a pas de job de
  migration/initialisation séparé pour Kopia.
- **Utilisateur stocké dans le dépôt + ACL, provisionnés à chaque démarrage.**
  `kopia server users
  add/set "${ADMIN_USERNAME}@kopia" --user-password="${REPO_PASSWORD}"` suivi de `kopia server acl enable`, tous deux idempotents (ajouter-ou-définir /
  activer-ou-ignorer). C'est ce qui autorise réellement une session d'instantané
  gRPC d'un client — l'authentification HTTP Basic (`ADMIN_PASSWORD`) seule ne le fait
  pas.
- **TLS généré une fois, réutilisé pour toujours.** Premier démarrage : pas de
  fichiers de certificat persistants → `--tls-generate-cert`, empreinte imprimée une fois dans
  les journaux. Chaque démarrage ultérieur : fichiers de certificat trouvés à
  `/var/lib/kopia/tls/` → réutilisés tels quels, pas de régénération (Kopia refuse de
  régénérer un certificat existant).
- **Commande de connexion client** — le flux exact, vérifié en direct :
  ```bash
  kopia repository connect server \
    --url=https://<external-ip>:<service-port> \
    --server-cert-fingerprint=<sha256-fingerprint> \
    --password=<REPO_PASSWORD> \
    --override-username=admin --override-hostname=kopia
  ```
  plus les variables d'environnement `KOPIA_SERVER_USERNAME=admin` / `KOPIA_SERVER_PASSWORD=<ADMIN_PASSWORD>` pour la couche
  d'authentification HTTP Basic externe utilisée par l'interface utilisateur
  Web/API de contrôle. Notez que le mot de passe utilisé pour la *connexion au
  dépôt* est `REPO_PASSWORD`, et non `ADMIN_PASSWORD` — voir [Kopia_Common §4](Kopia_Common.md#4-the-third-mechanism--a-repository-stored-user--acls).
- **Maintenance du dépôt en écriture unique.** La GC/compaction propre à Kopia
  suppose qu'un seul serveur possède le dépôt à la fois — conservez `max_instance_count = 1`.
- **La mise à l'échelle à zéro est sécurisée pour les données.** Le dépôt
  réside dans Cloud Storage, et non un volume local à l'instance, donc un
  démarrage à froid se reconnecte simplement (et, au tout premier démarrage,
  régénère le certificat TLS).
- **Les mises à jour recréent le pod.** Une augmentation de version reconstruit
  l'image personnalisée et recrée le pod unique ; la logique de connexion ou de
  création/utilisateur/ACL du point d'entrée s'exécute à nouveau sur le nouveau
  pod sans nécessiter de traitement spécial.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Kopia sont listés ; toute autre entrée est héritée de [App_GKE](App_GKE.md)
avec son comportement standard et ses valeurs par défaut. Voir le `modules/Kopia_GKE/README.md` pour la
référence exhaustive des entrées, groupe par groupe.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez `gke` pour exécuter côte à côte une variante Cloud Run d'une autre application sur le même locataire. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kopia` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Kopia ; `latest` épingle le build à `0.23.1` (Docker Hub, pas GHCR — pas d'ambiguïté de préfixe `v` ici). |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Les téléchargements/restaurations d'instantanés sont liés au CPU (compression, chiffrement, hachage) — augmentez pour les tâches de sauvegarde volumineuses/fréquentes. |
| `memory_limit` | `1Gi` | L'empreinte de Kopia est modeste ; une marge supplémentaire bénéficie au cache de contenu sur les dépôts avec de nombreux/grands instantanés. |
| `min_instance_count` | `0` | La mise à l'échelle à zéro est sécurisée — le dépôt réside dans Cloud Storage. |
| `max_instance_count` | `1` | Maintenez à `1` — la maintenance du dépôt de Kopia suppose une propriété de serveur unique. |
| `enable_cloudsql_volume` | `false` | Kopia n'a pas de Cloud SQL — maintenez `false`. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Kopia construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires en texte clair, fusionnés avec la valeur par défaut du module `ADMIN_USERNAME=admin`. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées en tant que variables d'environnement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessibilité externe par défaut — les clients distants doivent atteindre ce serveur. Utilisez `ClusterIP` uniquement lorsque chaque client s'exécute déjà dans le même cluster/VPC. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` uniquement si `stateful_pvc_enabled = true` (non recommandé — voir Groupe 7). |
| `termination_grace_period_seconds` | `60` | Secondes après SIGTERM avant SIGKILL — permet à Kopia de vider les écritures en cours. |

> **`service_port` n'est pas exposé par ce module** — voir §2E ci-dessus. Le port
> LoadBalancer externe est toujours `80` (la valeur par défaut `App_GKE`) ;
> `target_port` est le vrai `51515` de Kopia.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Disponible mais non recommandé.** La seule chose qui vivrait sur un PVC est le minuscule certificat TLS persistant — aucun besoin significatif d'IOPS/verrouillage qu'un périphérique de bloc améliore. GCS FUSE (par défaut) est suffisant. |
| `stateful_pvc_mount_path` | `/var/lib/kopia` | Doit correspondre au chemin de montage GCS FUSE par défaut si vous activez un PVC. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` par défaut — le certificat persistant est un petit fichier sans besoin d'IOPS élevées. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 15s, seuil de 10 tentatives | **TCP, pas HTTP** — chaque point de terminaison Kopia nécessite une authentification, donc une sonde de chemin HTTP renverrait toujours 401. |
| `liveness_probe` | TCP, délai de 30s, seuil de 3 tentatives | Même raisonnement que `startup_probe`. |
| `uptime_check_config` | désactivé | Si activé, il s'agit d'une vérification HTTP et échouera continuellement contre les points de terminaison de Kopia protégés par authentification. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job d'initialisation par défaut — la logique de connexion ou de création du point d'entrée le remplace. |
| `cron_jobs` | `[]` | CronJobs Kubernetes (par exemple, un `kopia maintenance run` périodique pour la GC du dépôt). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` (données du dépôt + persistance du certificat TLS). |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires — le montage du certificat TLS Kopia est ajouté automatiquement. |

### Groupe 15 / 16 — Redis / Base de données (non applicable) {#group-15--16--redis--database-not-applicable}

Kopia n'utilise ni l'un ni l'autre. `enable_redis` est codé en dur `false` dans `main.tf`
(remplaçant la valeur par défaut `App_GKE` de `true`) ; `database_type` est fixé à `NONE`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une passerelle pour un nom d'hôte personnalisé. Notez que le protocole client de Kopia est du gRPC brut, pas du HTTP de navigateur — un domaine personnalisé bénéficie principalement d'un `--url` stable pour les clients, pas d'une interface utilisateur navigable. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements, de sorte que les clients distants n'ont pas besoin de réépingler `--url`. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | IAP est conçu pour l'authentification navigateur/HTTP, pas pour le protocole d'instantané gRPC brut — il n'est approprié que pour protéger l'interface utilisateur Web sur un domaine personnalisé, pas le point de terminaison de connexion client. |

### Groupes 12, 8, 9, 13, 17, 18, 21, 22 {#groups-12-8-9-13-17-18-21-22}

Comportement standard de `App_GKE` — CI/CD et Binary Authorization, Quota de
ressources, Politiques de fiabilité, NFS, Sauvegarde et maintenance (générique
pour la fondation, pas le propre dépôt de Kopia), SQL personnalisé (non
applicable), Cloud Armor et VPC Service Controls. Voir [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `service_external_ip` | IP externe (lorsque `reserve_static_ip = true`) — la partie hôte de la valeur `kopia repository connect server --url=`. |
| `service_url` | URL calculée par la fondation. **Ne faites pas confiance au schéma/port pour Kopia** — par défaut, `http://<ip>` nu sans port ; confirmez le vrai port avec `kubectl get svc`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Vide par défaut — Kopia n'a pas de job d'initialisation. |
| `statefulset_name` | Nom du StatefulSet (uniquement lorsque `workload_type = "StatefulSet"`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — `workload_type = "Deployment"` avec
> `stateful_pvc_enabled = true`, IAP sans identités autorisées, unités de quota non binaires. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `REPO_PASSWORD` (Secret Manager) | Ne jamais renouveler manuellement après le premier déploiement | **Critique** | Il n'existe pas de chemin de rechiffrement pris en charge pour un dépôt en direct — le renouvellement de ce secret indépendamment du contenu réel du dépôt GCS orpheline en permanence chaque instantané existant. |
| Mot de passe de l'utilisateur du dépôt | Connectez les clients avec `--password=<REPO_PASSWORD>`, jamais `<ADMIN_PASSWORD>` | **Critique** | `kopia repository connect server` n'a pas de drapeau de mot de passe d'utilisateur de serveur séparé — son unique entrée de mot de passe EST l'identifiant de session gRPC, vérifié par rapport au mot de passe de l'utilisateur stocké dans le dépôt. L'utilisation de `ADMIN_PASSWORD` fait échouer chaque session avec `PermissionDenied`. |
| `max_instance_count` | `1` | **Critique** | La propre maintenance du dépôt de Kopia (GC/compaction) suppose une propriété de serveur unique ; un deuxième serveur concurrent exécute des maintenances en concurrence sur le même dépôt. |
| Sondes de santé | Laissez en TCP (par défaut du module) | **Élevé** | Chaque point de terminaison Kopia nécessite une authentification — une sonde de chemin HTTP renvoie toujours 401, et le pod ne devient jamais Prêt même si le serveur a démarré correctement. |
| URL/port de connexion client | Port explicite, confirmé via `kubectl get svc` | **Élevé** | `service_port` n'est pas exposé par ce module et est par défaut `80`, pas le vrai `51515` de Kopia. Un `https://<ip>` nu implique le port 443 (non ouvert) et échoue silencieusement à se connecter. |
| `uptime_check_config` | Laissez `enabled = false` (par défaut du module) | **Moyen** | S'il est activé, il émet une vérification HTTP contre un point de terminaison protégé par authentification et échouera continuellement, générant de fausses alertes. |
| `stateful_pvc_enabled` | Laissez `false`/non défini (par défaut du module) | **Faible** | Disponible, mais la seule chose qui y vivrait est le minuscule certificat TLS persistant — aucun avantage IOPS/verrouillage par rapport au montage GCS FUSE par défaut. |
| `enable_iap` | Uniquement pour l'interface utilisateur Web/API de contrôle, pas le point de terminaison de connexion client | **Moyen** | IAP est orienté authentification navigateur/HTTP ; il ne protège pas (et ne peut pas utilement) la session d'instantané gRPC brute. |
| Certificat TLS | Ne jamais supprimer `/var/lib/kopia/tls/*` hors bande | **Élevé** | Chaque client distant déjà connecté a épinglé l'ancienne empreinte via `--server-cert-fingerprint=` ; un certificat régénéré rompt chaque client existant jusqu'à ce qu'il réépingle. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Kopia est décrite dans
**[Kopia_Common](Kopia_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Kopia sur GKE Autopilot](../labs/Kopia_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Kopia Common — Configuration d'application partagée](Kopia_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [UrBackup sur GKE Autopilot](UrBackup_GKE.md), [Filebrowser sur GKE Autopilot](Filebrowser_GKE.md) dans la solution **Sauvegarde et reprise après sinistre**.
