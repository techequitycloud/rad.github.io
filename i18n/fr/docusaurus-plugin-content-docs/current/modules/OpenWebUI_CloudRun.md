---
title: "Open WebUI sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Open WebUI sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenWebUI_CloudRun.md @ 1665a43e sha256:6a0060522864 -->

# Open WebUI sur Google Cloud Run {#open-webui-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenWebUI_CloudRun.png" alt="Open WebUI sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Open WebUI est une interface d'IA auto-hébergée offrant une interface utilisateur
raffinée de type ChatGPT pour Ollama, les API compatibles OpenAI et des dizaines
d'autres fournisseurs de LLM. Ce module déploie Open WebUI sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud qu'Open WebUI utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité du service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte OpenWebUI sur RAD, et comment cela se compare {#what-openwebui-costs-on-rad-and-how-that-compares}

**Pour une petite équipe, OpenWebUI sur le module Cloud Run de RAD coûte environ
102 $ US par mois sans licence par utilisateur.** Il n'existe pas d'« Open WebUI
Cloud » officiel avec des prix publics — le projet est livré uniquement en tant
que logiciel auto-hébergé — donc un serveur auto-géré est la seule alternative
moins chère en espèces, et dans ce cas, vous gérez vous-même la base de données,
les sauvegardes, les correctifs de sécurité et les mises à niveau. Les chiffres
sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette
section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification,
une démo, une activité saisonnière — un projet géré par RAD peut être supprimé
et restauré dans les 30 jours pour quelques crédits, de sorte que ces 102 $ US
deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**,
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Identique |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 crédits par mois (environ 96 $ US au prix de la recharge, 77 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers
et le réseau sont partagés par toutes les applications du projet, donc une
deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1,
prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 Gio (scaleToZero) | 31,53 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 102 $ US** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg) ;
  la VM coûte environ 10 % de plus.
- **La mise à l'échelle à zéro est le comportement par défaut.** La ligne Cloud
  Run ci-dessus reflète déjà ce coût ; le réglage `min_instance_count = 1` maintient une instance
  chaude et augmente cette ligne, en échange de l'absence de démarrages à froid.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut
  une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio,
  ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- Il n'existe pas d'« Open WebUI Cloud » officiel avec des prix publics — le
  projet est livré en tant que logiciel auto-hébergé — donc cette comparaison
  se fait avec un serveur nu.
- Un VPS nu dimensionné proche de l'empreinte 2 vCPU / 4 Gio d'Open WebUI —
  Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24
  $/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49
  $/mois — est moins cher en espèces que les chiffres RAD ci-dessus.
- Le Cloud SQL géré par RAD (historique de chat, comptes) et Secret Manager (les
  clés API des fournisseurs LLM derrière lui) remplacent les sauvegardes, les
  correctifs et la gestion des secrets que vous feriez autrement vous-même sur
  un VPS.
- Si OpenWebUI doit rester actif sans mise à l'échelle à zéro, ou fonctionner
  à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide
  GKE](OpenWebUI_GKE.md) — environ 150 $ US par mois dans votre propre projet,
  ou 3 480 crédits (environ 278 à 348 $ US) par mois dans un projet géré par RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenWebUI s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela
convient bien mieux à une utilisation occasionnelle — préparation d'une
certification, environnement de démonstration, activité saisonnière — que
l'exécution continue d'OpenWebUI.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  cette période d'attente. Contrairement à la suppression d'un seul module,
  cela ne détruit pas Cloud SQL, aucune VM ou Cloud Run un par un — l'ensemble
  du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas un rebuild.** Dans les 30
  jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  réactiver le projet et de rattacher son compte de facturation, puis vous
  demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout
  est revenu. Comme rien n'a été détruit individuellement, cette mise à jour
  trouve les mêmes ressources déjà présentes — c'est une vérification, pas un
  rebuild, et une mise à jour ne facture jamais les frais de module à nouveau.
  Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique
  de 2 à 3 déploiements, contre les 115 crédits (11,50 $ US) qu'un redéploiement
  complet coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 102 $ US.** Déployez OpenWebUI, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé.
  Vous ne payez les frais de module qu'une seule fois, les builds, et le temps
  pendant lequel OpenWebUI était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un
  projet que vous apportez et dont RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du
  palier (100 crédits pour le palier sandbox qui convient à la plupart des
  utilisations d'étude et de démonstration). Google indique que la plupart des
  services fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les
  sauvegardes d'OpenWebUI sont écrites dans un bucket à l'intérieur du projet,
  et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probable qu'il disparaisse dès que vous supprimez
  le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez apporté des modifications à OpenWebUI que vous souhaitez conserver,
  copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet)
  avant de supprimer, comme pour le workflow de redéploiement ci-dessous. Pour
  une installation par défaut sans rien d'irremplaçable, cela n'a pas
  d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option
ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre
projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer
est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 115 crédits (11,50 $ US), car RAD recrée le projet et les
  services partagés avant OpenWebUI. La suppression ne permet d'économiser de
  l'argent que si OpenWebUI devait rester inutilisé pendant environ 4 jours ou
  plus, à la fois dans votre propre projet (environ 3,40 $ US par jour) et dans
  un projet géré par RAD (32 crédits par jour).
- **La majeure partie du coût de fonctionnement est généralement la base de
  données et la VM de fichier/cache partagée.** Elles ne s'arrêtent que si
  rien d'autre dans le projet ne les utilise, donc la suppression d'OpenWebUI
  alors que quelque chose d'autre partage le projet n'économise que la partie
  calcul d'OpenWebUI.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez
  la dernière sauvegarde avant de supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à
  nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session
  et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, afin que
  personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud à partir de l'API
Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing)
pour les propres frais de RAD et les estimations de crédits quotidiens ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud
Storage sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

Open WebUI s'exécute en tant que conteneur web Python sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service web Python, 2 vCPU / 4 Gio par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — les sessions, les conversations et les données RAG y résident toutes |
| Fichiers partagés | Filestore (NFS) | Optionnel — nécessaire uniquement lorsque plusieurs instances partagent des fichiers téléchargés |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Secrets | Secret Manager | `WEBUI_SECRET_KEY` et mot de passe de la base de données auto-générés |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** Open WebUI ne prend pas en charge MySQL ou tout
  autre moteur ; le type de base de données est fixé en interne.
- **Pas de Redis.** Open WebUI persiste les sessions et tout l'état de
  l'application dans PostgreSQL. La variable `enable_redis` est par défaut `false` et
  aucune variable d'environnement Redis n'est injectée.
- **`WEBUI_SECRET_KEY` est auto-généré** et stocké dans Secret Manager. Il signe toutes les
  sessions utilisateur ; sa rotation invalide simultanément toutes les sessions
  actives. Traitez-le comme immuable après la première utilisation.
- **Les nouveaux utilisateurs nécessitent l'approbation de l'administrateur par
  défaut.** `default_user_role = "pending"` signifie que les comptes auto-enregistrés ne peuvent pas
  accéder à l'interface utilisateur tant qu'un administrateur ne les a pas
  promus.
- **La mise à l'échelle à zéro est activée.** `min_instance_count` est par défaut `0` ;
  définissez-le sur `1` pour une instance chaude dans les déploiements
  d'équipe interactifs.
- **Les sondes de santé ciblent `/health`.** Open WebUI expose ce chemin
  nativement ; les sondes de démarrage et de vivacité utilisent HTTP contre
  celui-ci.
- **`DATABASE_URL` est assemblé automatiquement.** Le point d'entrée personnalisé le
  construit à partir des variables d'environnement `DB_*` injectées par la
  plateforme — ne le définissez pas manuellement.
- **L'environnement d'exécution Gen2 est requis** pour les montages NFS et
  l'Egress VPC direct.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Open WebUI {#a-cloud-run--the-open-webui-service}

Open WebUI s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge des requêtes entre le nombre minimum et
maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Open WebUI stocke toutes les données de l'application — comptes utilisateur,
conversations, indices RAG et embeddings de documents téléchargés — dans une
instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte
privativement via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP
publique). Lors du premier déploiement, un job d'initialisation crée la base de
données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
    --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (`openwebui-data`) est provisionné automatiquement pour
le répertoire de données backend d'Open WebUI. Le compte de service de la charge
de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Filestore (NFS) — stockage partagé optionnel {#d-filestore-nfs--optional-shared-storage}

NFS est activé par défaut. Il fournit un stockage persistant partagé à toutes
les instances, ce qui est important lorsque plusieurs instances sont en cours
d'exécution et que les fichiers téléchargés doivent être visibles partout. NFS
nécessite l'environnement d'exécution Gen2.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS et les exigences Gen2.

### E. Secret Manager {#e-secret-manager}

`WEBUI_SECRET_KEY` (clé de signature de session) et le mot de passe de la base de données
sont stockés dans Secret Manager et injectés dans le service au moment de
l'exécution ; le texte en clair n'apparaît jamais dans la configuration ou les
logs.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être superposés ; les paramètres d'ingress et l'egress VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Open WebUI {#3-open-webui-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) exécute `postgres:15-alpine` sur l'instance Cloud SQL via le
  Auth Proxy. Il crée de manière idempotente la base de données et l'utilisateur
  de l'application avant le démarrage du service.
- **Migrations de base de données au démarrage.** Open WebUI exécute ses
  propres migrations de schéma Alembic à chaque démarrage, de sorte que la mise
  à niveau `application_version` applique automatiquement toutes les nouvelles modifications de
  schéma. Au premier démarrage, cela peut prendre 30 à 60 secondes.
- **Assemblage de `DATABASE_URL`.** Le point d'entrée personnalisé (`entrypoint.sh`) assemble
  le `DATABASE_URL` à partir des variables d'environnement `DB_HOST`, `DB_USER`, `DB_PASSWORD` et
  `DB_NAME` injectées par la plateforme. Le mot de passe est encodé en URL pour
  gérer les caractères spéciaux. Ne surchargez pas `DATABASE_URL` directement.
- **`WEBUI_SECRET_KEY` est immuable.** La clé signe toutes les sessions utilisateur. Sa
  rotation déconnecte immédiatement tous les utilisateurs actifs et invalide
  tous les jetons de connexion automatique. Traitez-la comme permanente après
  la première connexion.
- **Connexion au backend AI.** Open WebUI se connecte à une instance Ollama ou
  à une API compatible OpenAI au démarrage. Si ni `ollama_base_url` ni `openai_api_base_url` n'est
  configuré, l'interface utilisateur démarre mais n'a pas de backend AI —
  toutes les requêtes d'inférence de modèle échouent. Fournissez les clés API
  (par exemple `OPENAI_API_KEY`) via `secret_environment_variables`, et non `environment_variables`.
- **Flux d'enregistrement des utilisateurs.** Avec `default_user_role = "pending"` (par défaut), tous
  les comptes auto-enregistrés doivent être promus par un administrateur avant
  de pouvoir utiliser l'interface utilisateur. Le premier compte
  administrateur doit être créé directement via la page d'inscription au
  premier démarrage.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent HTTP
  contre `/health`, qui renvoie 200 une fois que l'application et la connexion à la
  base de données sont prêtes. La sonde de démarrage autorise jusqu'à 300
  secondes (30 échecs × période de 10 secondes) pour que la migration au
  premier démarrage se termine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Open WebUI sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openwebui` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Open WebUI` | Nom convivial affiché dans la console. |
| `description` | `Open WebUI — self-hosted AI interface for Ollama and OpenAI-compatible APIs` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Open WebUI. Épinglez à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner l'infrastructure uniquement. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés pour les charges de travail RAG. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 Gio recommandés (les pipelines RAG peuvent utiliser 3 à 6 Gio). |
| `min_instance_count` | `0` | Instances minimales ; définissez `1` pour maintenir une instance chaude pour une utilisation interactive. |
| `max_instance_count` | `3` | Instances maximales. |
| `container_port` | `8080` | Port HTTP d'Open WebUI (correspond au `EXPOSE` de l'image officielle). |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et l'Egress VPC direct. |
| `timeout_seconds` | `300` | Durée maximale de la requête. Augmentez à `600`–`3600` pour l'ingestion de documents ou les backends LLM lents. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — doit être `true` lors de la connexion à Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Open WebUI dans Artifact Registry (évite les limites de débit de GHCR). |
| `traffic_split` | `[]` | Allocation de trafic canari/bleu-vert entre les révisions. |

### Groupe 5 — Paramètres et accès Open WebUI {#group-5--open-webui-settings--access}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ollama_base_url` | `""` | URL de base pour le backend Ollama (par exemple `http://ollama:11434`). Laissez vide si vous n'utilisez pas Ollama directement. |
| `openai_api_base_url` | `""` | URL de base pour une API compatible OpenAI (par exemple `https://api.openai.com/v1`). Doit inclure le suffixe `/v1`. |
| `default_user_role` | `pending` | Rôle attribué aux nouveaux comptes auto-enregistrés. `pending` nécessite l'approbation de l'administrateur ; `user` accorde un accès immédiat. |
| `enable_signup` | `true` | Autoriser la page d'inscription. Définissez `false` après la création des comptes administrateur en production. |
| `webui_auth` | `true` | Activer le formulaire de connexion. Définissez `false` uniquement pour les déploiements mono-utilisateur ou entièrement isolés. |
| `ingress_settings` | `all` | Quelles sources de trafic peuvent atteindre le service (`all`, `internal`, `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas surcharger `DATABASE_URL` ou `WEBUI_SECRET_KEY`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. À utiliser pour `OPENAI_API_KEY` et des valeurs sensibles similaires. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS
après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé — nécessaire lorsque plusieurs instances partagent des fichiers téléchargés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse pour des répertoires supplémentaires adossés à des buckets. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Open WebUI nécessite PostgreSQL 15. |
| `db_name` | `openwebui_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `openwebui_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Open WebUI n'a pas de commandes planifiées requises ; ajoutez ici toutes les tâches récurrentes spécifiques à l'application. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 30 s, délai d'attente de 5 s, période de 10 s, 30 tentatives | Permet jusqu'à ~5 minutes pour le démarrage au premier boot. |
| `liveness_probe` | HTTP `/health`, délai de 60 s, délai d'attente de 5 s, période de 30 s, 3 tentatives | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Redis n'est pas nécessaire — Open WebUI persiste tout l'état dans PostgreSQL. |
| `redis_host` | `""` | Point de terminaison Redis (pertinent uniquement si `enable_redis` est défini sur `true`). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_cloudsql_volume` | `true` | Critique | La désactivation rompt toutes les connexions à la base de données lors de l'utilisation de Cloud SQL. Ne désactiver que lors de la connexion à un PostgreSQL externe via TCP. |
| `WEBUI_SECRET_KEY` (auto-généré) | immuable après la première utilisation | Critique | La rotation de la clé déconnecte immédiatement tous les utilisateurs actifs et invalide tous les jetons de connexion automatique. |
| `webui_auth` | `true` | Critique | La désactivation supprime le formulaire de connexion — toute personne pouvant atteindre l'URL a un accès administrateur complet sans identifiants. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; la modification recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `database_type` (fixe) | `POSTGRES_15` | Critique | Open WebUI nécessite PostgreSQL ; tout autre moteur rompt les migrations et le démarrage. |
| `ollama_base_url` / `openai_api_base_url` | au moins un défini | Élevé | Sans URL de backend, Open WebUI démarre mais toutes les requêtes d'inférence de modèle échouent immédiatement. |
| `default_user_role` | `pending` | Élevé | `user` approuve automatiquement toutes les auto-inscriptions ; sur un service exposé publiquement, cela permet une inscription illimitée. |
| `enable_signup` | `true` (définir `false` en production après l'intégration) | Élevé | Combiné avec `default_user_role = "user"`, tout visiteur peut s'auto-enregistrer et accéder à tous les modèles. |
| `memory_limit` | `4Gi` | Élevé | Les pipelines RAG peuvent consommer 3 à 6 Gio sous charge ; une mémoire insuffisante provoque des arrêts OOM en cours d'ingestion. |
| `backup_schedule` | `0 2 * * *` | Élevé | Sans sauvegardes automatisées, la base de données PostgreSQL (utilisateurs, conversations, données RAG) n'est pas protégée. |
| `ingress_settings` | restreindre en production | Élevé | `all` expose l'interface utilisateur à l'internet public — combiner avec `webui_auth = true` et `default_user_role = "pending"`. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS et l'Egress VPC direct ne sont pas pris en charge en gen1. |
| `application_version` | version épinglée en production | Moyen | `latest` risque une mise à niveau involontaire avec un changement de schéma qui fait planter le démarrage. |
| `min_instance_count` | `1` pour une utilisation interactive | Moyen | `0` ajoute une latence de démarrage à froid de 20 à 40 s lorsque la première requête arrive. |
| `enable_nfs` | `true` lorsque `max_instance_count > 1` | Moyen | Sans stockage partagé, les fichiers téléchargés sont locaux à l'instance et invisibles pour les autres réplicas. |
| `timeout_seconds` | `300` (augmenter pour RAG/LLM) | Moyen | L'ingestion de documents et les réponses de grands modèles sont coupées au délai d'attente de Cloud Run. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans eux, l'interface utilisateur est accessible publiquement avec seulement l'authentification intégrée d'Open WebUI comme porte d'accès. |

---

Pour le comportement de base référencé tout au long — identité du service, mise
à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Open WebUI partagée avec la variante GKE est décrite
dans **[OpenWebUI_Common](OpenWebUI_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : OpenWebUI sur Cloud Run](../labs/OpenWebUI_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Open WebUI sur GKE Autopilot](OpenWebUI_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Open WebUI Common — Configuration d'application partagée](OpenWebUI_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) dans la solution **Assistant IA privé**.
