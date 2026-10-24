---
title: "code-server sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de code-server sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CodeServer_CloudRun.md @ 1665a43e sha256:a7b669c3f7b6 -->

# code-server sur Google Cloud Run {#code-server-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_CloudRun.png" alt="code-server sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server est la version open source (MIT) de Visual Studio Code de Coder qui
s'exécute sur un serveur distant et est entièrement accessible via le navigateur —
un IDE complet avec la place de marché d'extensions VS Code, un terminal intégré
et des serveurs de langage, soutenu par un espace de travail persistant. Ce
module déploie code-server sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par code-server et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte CodeServer sur RAD, et comment cela se compare {#what-codeserver-costs-on-rad-and-how-that-compares}

**CodeServer sur le module Cloud Run de RAD coûte environ 32,57 US$ par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 40 crédits (4 US$).** CodeServer est la version open source de VS Code de Coder qui s'exécute dans le navigateur sur un espace de travail cloud persistant. GKE Autopilot convient à CodeServer qui doit rester actif, s'adapter à travers les pods ou s'exécuter aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, ce module Cloud Run est généralement le bon choix — voir le [guide GKE](CodeServer_GKE.md) si vous avez besoin de l'autre.

Si CodeServer n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 32,57 US$ deviennent quelques dollars par mois à la place. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 US$ au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3–6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **32,57 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **15 crédits par jour**, environ 450 par mois (environ 45 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, donc une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 US$ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 32,57 US$** |

### Comment cela se compare {#how-it-compares}

- **GitHub Codespaces**, l'équivalent géré le plus proche, est gratuit pour les particuliers jusqu'à 120 heures-cœur (60 heures sur une machine à 2 cœurs) et 15 Go-mois de stockage, puis 0,18 $/heure pour une machine à 2 cœurs (doublant avec le nombre de cœurs) plus 0,07 $/Go-mois pour le stockage.
- Si vous l'exécutez vous-même, un petit VPS exécutant code-server vous coûtera moins cher en espèces : une Hetzner CPX22 ou une DigitalOcean 2 vCPU/4 Go coûte environ 24 $ par mois, ou un GCP `e2-standard-2` environ 49 $ par mois — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que les Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, plus la possibilité de mettre CodeServer en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si CodeServer s'exécute dans **un projet que RAD gère pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à CodeServer dont vous n'avez besoin qu'occasionnellement que de l'exécuter en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà dissociée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne supprime pas la VM ou les ressources Cloud Run une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela représente une poignée de crédits (moins de 1 US$) au total pour une chaîne CodeServer typique, contre les 45 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 32,57 US$.** Déployez CodeServer, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures pendant lesquelles il a été réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé CodeServer et souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run conserve une instance chaude, il ne se met donc pas complètement à l'échelle zéro par lui-même. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 45 crédits (4,50 US$) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si CodeServer devait rester inutilisé pendant environ 5 jours ou plus, que ce soit dans votre propre projet ou dans un projet géré par RAD.
- **La majeure partie du coût d'exécution est généralement le serveur de fichiers ou de cache partagé.** Il ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression de CodeServer alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; [GitHub Codespaces](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

code-server s'exécute comme un conteneur autonome unique sur Cloud Run v2.
Contrairement aux applications basées sur une base de données, il relie un
ensemble délibérément minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur unique écoutant sur le port **8080** ; 1 vCPU / 1 GiB par défaut |
| Espace de travail persistant | Cloud Filestore (NFS) | `/home/coder` est sur le partage NFS par défaut ; le bucket de l'espace de travail est monté là via GCS FUSE uniquement si NFS est désactivé |
| Base de données | _Aucune_ | `database_type = NONE` — code-server n'a pas de base de données SQL |
| Cache et file d'attente | _Aucun_ | Redis est explicitement désactivé (`enable_redis = false`) |
| Secrets | Secret Manager | Mot de passe de l'éditeur auto-généré `PASSWORD` (quand `enable_password = true`) |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | **L'ingress par défaut est `all`** — accessible publiquement par défaut ; le `PASSWORD` auto-généré protège la page de connexion |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données et pas de Redis.** code-server est un conteneur unique ;
  tout l'état réside dans le volume de l'espace de travail. `database_type` est fixé à
  `NONE` par la couche d'application partagée et Redis est désactivé.
- **L'ingress est `all` (public) par défaut.** Le service est accessible depuis
  l'internet public dès la sortie de la boîte, protégé par le `PASSWORD`
  auto-généré. Conservez `enable_password = true` chaque fois que `ingress_settings = "all"`, ou passez à
  `ingress_settings = "internal"` pour restreindre l'accès au VPC.
- **Un `PASSWORD` d'éditeur aléatoire est généré automatiquement** et stocké dans
  Secret Manager. Il protège la page de connexion. La désactivation de
  `enable_password` sert l'éditeur sans authentification — uniquement sûr derrière
  l'ingress `internal`.
- **L'espace de travail est sur NFS à `/home/coder`.** Les paramètres, les extensions
  et les projets ouverts y persistent. Conservez `enable_nfs = true` : sur le repli GCS
  FUSE, l'installation d'une extension échoue, car GCS FUSE ne peut pas
  renommer un répertoire. Nécessite l'environnement d'exécution `gen2` (par
  défaut).
- **Instance unique par conception.** `min_instance_count = max_instance_count = 1`. code-server conserve l'état de
  l'éditeur par session en mémoire et possède un volume d'espace de travail ;
  une mise à l'échelle au-delà d'une instance diviserait les sessions et
  risquerait des écritures concurrentes sur le même volume.
- **Les sondes de santé atteignent `/healthz`, pas `/health`.** `/healthz` n'est pas
  authentifié et renvoie `200` une fois que le serveur écoute ; `/health`
  renvoie `401` lorsqu'un mot de passe est défini et ferait échouer la
  sonde.
- **L'image est un mince wrapper sur `codercom/code-server`**, construite et mise en miroir
  dans Artifact Registry via Cloud Build ; `latest` se fixe à `4.99.1` au moment
  de la construction.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service code-server {#a-cloud-run--the-code-server-service}

code-server s'exécute comme un service Cloud Run v2 écoutant sur le port 8080.
Chaque déploiement crée une révision immuable ; comme l'application est à
instance unique et avec état, conservez `min = max = 1` et évitez le partage de trafic
entre les révisions concurrentes.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~codeserver"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et le partage de trafic.

### B. Cloud Storage — le volume de l'espace de travail {#b-cloud-storage--the-workspace-volume}

Le seul emplacement avec état est `/home/coder` — l'espace de travail de l'utilisateur,
les paramètres VS Code et les extensions installées. Par défaut, c'est le chemin
de montage NFS, qui survit aux redéploiements de révision et aux événements de
mise à l'échelle. Un bucket **Cloud Storage** dédié est également provisionné ;
il est monté comme un volume **GCS FUSE** à `/home/coder` uniquement lorsque `enable_nfs = false`,
où les installations d'extensions échouent.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  ```

NFS et GCS FUSE nécessitent tous deux l'environnement d'exécution `gen2` (par
défaut). Voir [App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et
CMEK.

### C. Secret Manager — le mot de passe de l'éditeur {#c-secret-manager--the-editor-password}

Lorsque `enable_password = true` (par défaut), un `PASSWORD` aléatoire de 24 caractères est généré et
stocké dans Secret Manager, puis injecté comme variable d'environnement `PASSWORD` du
conteneur pour protéger la page de connexion. Il n'y a pas de mot de passe de
base de données (pas de base de données).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la
rotation des secrets.

### D. Réseau et ingress {#d-networking--ingress}

Le service utilise par défaut l'**ingress `all`** — accessible depuis
l'internet public, avec le `PASSWORD` auto-généré protégeant la page de connexion.
Pour restreindre l'accès au VPC, définissez `ingress_settings = "internal"`, ou ajoutez un équilibreur
de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte facultatives. Un point de terminaison public est
nécessaire pour qu'une vérification de disponibilité atteigne le service.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application code-server {#3-code-server-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** code-server
  n'a pas de base de données SQL et pas de job d'initialisation. Le service démarre
  dès que le conteneur démarre et se lie à `0.0.0.0:8080` (défini via `BIND_ADDR`).
- **Pas de migrations.** La mise à niveau du `application_version` déploie simplement une
  nouvelle révision sur la nouvelle image ; il n'y a pas de schéma à migrer.
- **L'espace de travail est le seul état durable.** Tout ce qui se trouve sous
  `/home/coder` — dossiers ouverts, `settings.json`, raccourcis clavier et chaque extension
  installée — persiste sur le partage NFS. Le supprimer efface l'espace de
  travail.
- **La connexion est protégée par le secret `PASSWORD`.** Avec `enable_password = true`, l'éditeur
  demande le mot de passe généré. Récupérez-le depuis Secret Manager (§2C). S'il
  est désactivé, toute personne atteignant l'URL obtient un IDE non authentifié
  — ne l'exécutez de cette manière que derrière l'ingress `internal`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent le point
  de terminaison non authentifié `/healthz` (renvoie `200` une fois que le
  serveur HTTP écoute). Ne **pas** pointer les sondes vers `/health` lorsqu'un
  mot de passe est défini — il renvoie `401` et la révision ne devient
  jamais prête. Vérifiez l'environnement et le port de la révision en cours
  d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Mise à l'échelle à instance unique.** Conservez `min = max = 1`. Les sessions
  d'éditeur sont conservées en mémoire et le volume de l'espace de travail a un
  seul rédacteur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
code-server sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `codeserver` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `code-server` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image code-server ; `latest` se fixe à `4.99.1` au moment du build. Fixez-vous à une version spécifique en production. |
| `enable_password` | `true` | Génère un `PASSWORD` d'éditeur aléatoire et le demande à la connexion. **Laissez activé pour tout déploiement accessible publiquement.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez pour les serveurs de langage lourds. |
| `memory_limit` | `1Gi` | Mémoire par instance ; dimensionnez en fonction des espaces de travail et des extensions que vous exécutez. |
| `min_instance_count` | `1` | Gardez à 1 — éditeur à instance unique ; évite les retards de démarrage à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | Gardez à 1 — un volume d'espace de travail, session en mémoire. |
| `container_port` | `8080` | code-server écoute sur 8080. |
| `execution_environment` | `gen2` | Requis pour GCS FUSE (montage de l'espace de travail) et NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | code-server n'a pas de Cloud SQL — gardez false. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image code-server dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut (protégé par le secret `PASSWORD`). Définissez `internal` pour restreindre l'accès au VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'éditeur. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `{ TZ = "UTC" }`). `BIND_ADDR` est défini automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : `/home/coder` contient les paramètres, les extensions et les projets, et l'installation d'une extension échoue sur GCS FUSE (il ne peut pas renommer un répertoire). |
| `nfs_mount_path` | `/home/coder` | Chemin de montage si NFS est activé. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le bucket de l'espace de travail est ajouté automatiquement à `/home/coder` uniquement lorsque `enable_nfs = false`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non référencé — code-server n'a pas de base de données SQL ; fixé à `NONE` par CodeServer_Common. |
| `database_password_length` | `32` | Non référencé — transmis à la fondation pour compatibilité. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz` 15s de délai | Sonde de démarrage ; utilise le point de terminaison non authentifié. |
| `liveness_probe` | HTTP `/healthz` 30s de délai | Sonde de vivacité ; utilise le point de terminaison non authentifié. |
| `health_check_config` | HTTP `/health` | Sonde structurée alternative (point de terminaison authentifié). |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Vérification de disponibilité Cloud Monitoring facultative (nécessite un point de terminaison public). |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `codeserver_url` | URL de l'éditeur code-server (port 8080). Accessible uniquement au sein du VPC lorsque l'ingress est `internal`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
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
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> environnement d'exécution `gen1` avec des montages GCS FUSE/NFS, IAP sans
> identités autorisées, un `timeout_seconds` hors plage, etc. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création
> de toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_password` | `true` (garder activé pour l'ingress public) | Critique | La désactivation avec `ingress_settings = "all"` expose un IDE entièrement non authentifié — y compris un terminal — à Internet. |
| `enable_nfs` | `true` (par défaut) | Critique | Le partage NFS à `/home/coder` est le seul état persistant. La désactivation de NFS déplace l'espace de travail sur GCS FUSE, où les installations d'extensions échouent. |
| `startup_probe` / chemin `liveness_probe` | `/healthz` | Élevé | Pointer les sondes vers `/health` alors qu'un mot de passe est défini renvoie `401` ; la révision ne devient jamais prête. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 divise les sessions d'éditeur entre les instances et risque des écritures concurrentes sur le volume d'espace de travail unique. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid et remonte l'espace de travail à la prochaine requête. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter NFS ou GCS FUSE — le volume de l'espace de travail échoue et l'état est perdu au redémarrage. |
| `ingress_settings` | `all` + mot de passe (ou `internal`) | Élevé | `all` sans mot de passe publie un IDE ouvert ; `internal` bloque tout accès au navigateur depuis l'extérieur du VPC. |
| `enable_cloudsql_volume` | `false` | Faible | code-server n'a pas de base de données ; l'activation ajoute un sidecar Auth Proxy inutilisé. |
| `memory_limit` | `1Gi`+ | Moyen | Les serveurs/extensions de langage lourds peuvent provoquer un OOM en dessous de 1 GiB. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à code-server partagée avec la variante GKE est décrite dans
**[CodeServer_Common](CodeServer_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : code-server sur Cloud Run](../labs/CodeServer_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [code-server sur GKE Autopilot](CodeServer_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [CodeServer Common — Configuration d'application partagée](CodeServer_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Coder sur Google Cloud Run](Coder_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Environnements de développement Cloud**.
