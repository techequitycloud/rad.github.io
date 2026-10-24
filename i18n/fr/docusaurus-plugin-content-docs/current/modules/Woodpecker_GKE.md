---
title: "Woodpecker CI sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Woodpecker CI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Woodpecker_GKE.md @ 1665a43e sha256:482e2e97abb6 -->

# Woodpecker CI sur GKE Autopilot {#woodpecker-ci-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Woodpecker_GKE.png" alt="Woodpecker CI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Woodpecker CI est un moteur CI/CD léger et natif des conteneurs — une
alternative plus simple et auto-hébergeable à Drone. Les pipelines sont
définis comme des fichiers YAML, et chaque étape de pipeline s'exécute dans
son propre conteneur. Woodpecker prend en charge GitHub, Gitea, Forgejo,
GitLab et Bitbucket comme "forges" — le terme utilisé par Woodpecker pour
désigner l'hôte Git connecté. Ce module déploie Woodpecker sur **GKE
Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Il n'y a pas de `Woodpecker_CloudRun`, et il n'y en aura pas. Le backend
d'exécution de Woodpecker (`WOODPECKER_BACKEND=kubernetes`) a besoin d'un accès réel à
l'API Kubernetes pour créer dynamiquement un pod pour chaque étape de
pipeline — Cloud Run n'a pas le privilège pour le docker-in-docker et aucune
API Kubernetes à appeler. Voir [Woodpecker_Common](Woodpecker_Common.md) pour
l'explication complète ; il s'agit de la même classe architecturale de lacune
que les autres modules de ce catalogue **Common + GKE uniquement** (Kopia,
RocketChat, Immich, Temporal, Prowlarr, VictoriaMetrics, Plausible, LobeChat,
Supabase).

Ce guide se concentre sur les services cloud utilisés par Woodpecker et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et le cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## Ce que coûte Woodpecker CI sur RAD, et comment cela se compare {#what-woodpecker-ci-costs-on-rad-and-how-that-compares}

**L'exécution de Woodpecker CI sur des pods GKE Autopilot dans votre propre projet Google Cloud coûte environ 136,37 $/mois en frais Google Cloud**, en plus d'un frais de module RAD unique de 175 crédits facturé une fois au moment du déploiement. Woodpecker a besoin d'une base de données PostgreSQL derrière lui, ce qui, avec le pod lui-même, représente la majeure partie de ces 136,37 $. Dans un projet géré par RAD, les frais de module tombent à 157,5 crédits (10 % de moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être facturé directement par Google — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut égaler. Woodpecker est proposé uniquement sur GKE — il n'existe pas de variante Cloud Run de ce module.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 175 crédits | 157,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 136,37 $/mois, facturé par Google au prix catalogue | ~106 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Pod GKE Autopilot, 2x vCPU / 4 GiB | 79,35 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 $ |
| **Total** | **136,37 $** |

*Les frais de gestion de cluster GKE sont exclus du total ci-dessus car ils sont partagés entre toutes les applications GKE du projet — 0 $ si c'est le seul, sinon environ 73 $/mois répartis entre le nombre d'applications que vous exécutez.*

### Comment cela se compare {#how-it-compares}

- Woodpecker CI est livré uniquement en tant que logiciel auto-hébergé — son site de projet ne propose aucune offre SaaS hébergée (vérifié le 8 octobre 2026), la comparaison est donc "gérer un VPS vous-même" contre "laisser RAD gérer la même pile basée sur Postgres".
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un Droplet DigitalOcean 2 vCPU/4 Go coûte le même 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — suffisant pour exécuter le serveur Woodpecker, un agent et Postgres ensemble, à un prix affiché inférieur à la pile GKE gérée par RAD.
- Ce que ce prix n'inclut pas : les sauvegardes, les correctifs de sécurité, le renouvellement TLS et la charge opérationnelle de maintenir un serveur CI patché et en ligne — Cloud SQL, Secret Manager et la surveillance gérés par RAD absorbent cela pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
pendant la pause. La suppression d'un projet géré par RAD délie d'abord sa
facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement
à la suppression d'un seul module, cela ne démantèle **pas** Cloud SQL,
aucune VM, ni la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du
projet, demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque
déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà
présentes — c'est une vérification, pas une reconstruction, et une mise à
jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une
poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement
typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet que RAD
gère uniquement pour la facturation), vous devez le restaurer vous-même dans
les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre
solde de crédits achetés doit toujours dépasser le seuil du niveau (100
crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo
conviennent). Google indique que la plupart des services sont à nouveau
pleinement fonctionnels dans les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé Woodpecker CI et que vous
souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou
un bucket en dehors du projet) avant de supprimer. Pour une installation par
défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un
projet géré par RAD, il n'y a pas de pause gratuite — la suppression
supprime les ressources définitivement, et ramener Woodpecker CI signifie un
redéploiement à partir de zéro. Cela coûte environ 178-181 crédits (les 175
crédits de frais de module plus un build).

La suppression ne permet d'économiser de l'argent que si Woodpecker CI
devait rester inutilisé suffisamment longtemps pour compenser ce coût de
redéploiement par rapport à son propre coût d'exécution — pour Woodpecker CI,
cela représente environ 4 jours ou plus. La majeure partie de ce coût
d'exécution est généralement la base de données — elle ne s'arrête que si
rien d'autre dans le projet ne l'utilise, donc la suppression de cette
application alors que quelque chose d'autre partage le projet n'économise que
sa propre part de calcul.

Gardez les données en premier : les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, alors
copiez la dernière sauvegarde avant de la supprimer si vous voulez la
conserver.

### Sessions de labo et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de labo, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet
Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
définie par le formateur. Soit le formateur finance toutes les places, soit
chaque participant paie la sienne. Tout est supprimé à la fin de la session
et les crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les sociétés de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il
finance, et règle directement avec le client. Si le portefeuille est faible,
la facturation est interrompue et les données sont conservées, afin que
personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le
projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Woodpecker s'exécute comme un **pod unique qui co-localise le serveur et
l'agent** dans un seul conteneur, soutenu par Cloud SQL PostgreSQL :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Un pod exécute à la fois le serveur (API HTTP + interface web) et l'agent (exécuteur d'étapes de pipeline), 2 vCPU / 4Gi par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Le serveur migre automatiquement son propre schéma au démarrage ; pas de job de migration séparé |
| Exécution de pipeline | GKE Autopilot, via un RBAC `Role` limité à l'espace de noms | L'agent crée dynamiquement un Pod Kubernetes (plus des PVC/Services/Secrets si nécessaire) pour chaque étape de pipeline, dans le MÊME espace de noms que celui où l'agent lui-même s'exécute |
| Secrets | Secret Manager | Un secret : `WOODPECKER_AGENT_SECRET`, authentifiant la connexion gRPC co-localisée serveur↔agent |
| Forge (hôte git) | aucune provisionnée — externe | Valeurs Gitea/Forgejo par défaut ; pointer vers une instance réelle après le déploiement |
| Ingress | Cloud Load Balancing | `LoadBalancer` par défaut ; le déploiement de référence a utilisé `ClusterIP` en raison d'un quota d'IP externe épuisé (voir §6) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Le serveur et l'agent sont co-localisés dans un seul pod, pas deux.**
  Woodpecker en amont livre le serveur et l'agent comme deux images
  distinctes (docker-compose les exécute comme deux conteneurs). Ce module
  greffe le binaire de l'agent sur l'image du serveur et le démarre comme un
  processus en arrière-plan avant de `exec` le serveur —
  nécessaire car le backend Kubernetes de l'agent doit s'exécuter sous le
  MÊME ServiceAccount Kubernetes qui détient le RBAC élevé que ce module
  accorde, et le mécanisme générique `additional_services` de GKE n'exécute
  pas les déploiements sidecar sous le propre ServiceAccount de l'application
  principale (seul le déploiement principal le fait).
- **L'agent a besoin d'un RBAC élevé dans le cluster.** Le `Woodpecker_GKE`
  de `woodpecker.tf` provisionne directement un `kubernetes_role_v1` +
  `kubernetes_role_binding_v1` limité à l'espace de noms (aucune modification de la
  fondation `App_GKE` n'a été nécessaire). Voir §3 pour tous les
  détails.
- **Aucune balise `:latest` n'existe en amont, par conception.**
  Confirmé en direct : `docker run woodpeckerci/woodpecker-server:latest` imprime juste un avis de schéma de
  balise et se termine — une mesure délibérée anti-mise à niveau majeure
  accidentelle. `application_version = "latest"` se résout en interne en un `v3.16.0`
  épinglé.
- **Les deux images en amont sont véritablement distroless.** Confirmé via
  `docker
  export` : l'ensemble du rootfs est le binaire unique plus
  `/etc/passwd,group,
  hosts` — pas de shell du tout. L'image personnalisée greffe un
  binaire `busybox:musl` statique (la balise `busybox:stable` par défaut est
  liée dynamiquement et échoue dans ce rootfs sans libc) afin que le point
  d'entrée cloud puisse s'exécuter.
- **Le serveur exige impérativement une forge pour démarrer.** Confirmé en
  direct : l'omission de la configuration de la forge est une sortie fatale
  ("forge non configurée"), pas une page vide dégradée. Ce module utilise
  par défaut des valeurs Gitea/Forgejo de substitution afin qu'il se déploie
  proprement ; les déclencheurs de pipeline réels nécessitent une forge
  réelle enregistrée après le déploiement (§6).
- **Instance unique, non négociable.** `max_instance_count` est plafonné à
  `1` par une validation au moment de la planification — chaque
  pod exécute un serveur + agent co-localisé, et le serveur de Woodpecker n'a
  pas de coordination multi-instance documentée/vérifiée pour son propre état
  basé sur la base de données.
- **Point de terminaison de santé :** `GET /healthz`, confirmé en direct
  pour renvoyer `204 No
  Content`, non authentifié.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Woodpecker {#a-gke-autopilot--the-woodpecker-workload}

Un seul pod exécute à la fois le serveur et l'agent (Déploiement par défaut).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la
  charge de travail Woodpecker pour voir le pod et les événements.
- **CLI :**
  ```bash
  kubectl get deployment,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment fonctionnent la planification
Autopilot et Workload Identity.

### B. Cloud SQL — PostgreSQL 15 {#b-cloud-sql--postgresql-15}

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
```

Aucun job de migration séparé ne s'exécute — confirmé en direct : le serveur
de Woodpecker migre automatiquement son propre schéma au démarrage
("Initializing Schema" apparaît automatiquement sur une base de données
vide). Seul un job `db-init` (création de rôle + base de données)
s'exécute lors du premier déploiement.

### C. Secret Manager — un secret {#c-secret-manager--one-secret}

```bash
gcloud secrets list --project "$PROJECT" --filter="name~agent-secret"
gcloud secrets versions access latest --project "$PROJECT" --secret=<secret-name>
```

`WOODPECKER_AGENT_SECRET` authentifie la connexion gRPC interne du serveur et de
l'agent co-localisés. Voir
[Woodpecker_Common §2](Woodpecker_Common.md#2-woodpecker_agent_secret--the-one-generated-secret)
pour plus de détails.

### D. RBAC — les permissions d'exécution de pipeline de l'agent {#d-rbac--the-agents-pipeline-execution-permissions}

```bash
kubectl get role,rolebinding -n "$NAMESPACE"
kubectl describe role <resource-prefix> -n "$NAMESPACE"
```

Un `Role` limité à l'espace de noms accorde `{persistentvolumeclaims, services,
secrets: create, delete}`,
`{pods: watch, create, delete, get, list}` et `{pods/log: get}` — provenant du modèle RBAC du
chart Helm officiel de Woodpecker, non deviné. Le sujet `RoleBinding` est
le propre ServiceAccount Kubernetes du pod, lié par son nom. Voir
[Woodpecker_Common §6](Woodpecker_Common.md#6-kubernetes-execution-backend)
et §3 ci-dessous pour le mécanisme complet.

### E. Réseau et ingress {#e-networking--ingress}

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT"
```

`service_type` est par défaut `LoadBalancer` (externe),
correspondant à la valeur par défaut de la Fondation. Les webhooks de forge
doivent atteindre ce serveur depuis Internet pour que les pipelines se
déclenchent automatiquement — voir §6 pour la déviation `ClusterIP`
du déploiement de référence et quand la rétablir.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les
métriques GKE sont envoyées à Cloud Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

Un `uptime_check_config` est disponible, désactivé par défaut, ciblant
`/healthz`.

---

## 3. Comportement de l'application Woodpecker {#3-woodpecker-application-behaviour}

- **Serveur + agent co-localisés, un conteneur.** `entrypoint.sh` démarre
  l'agent en tant que processus en arrière-plan, puis `exec` le
  serveur au premier plan :
  ```sh
  if [ "${1:-}" = "/bin/woodpecker-server" ]; then
    /bin/woodpecker-agent &
  fi
  exec "$@"
  ```
  Ceci est nécessaire car le mécanisme générique `additional_services` de GKE
  exécute un déploiement sidecar sous le ServiceAccount par défaut de
  l'espace de noms, et non le propre ServiceAccount Kubernetes de
  l'application principale — et le backend Kubernetes de l'agent doit
  s'exécuter en tant qu'identité à laquelle le RBAC `Role`/`RoleBinding`
  ci-dessous accorde réellement des permissions.
- **RBAC, lié uniquement par le nom du ServiceAccount.** Confirmé en direct
  via `kubectl
  get deployment -o jsonpath='{.spec.template.spec.serviceAccountName}'` : `App_GKE` nomme le KSA du pod d'après le
  préfixe de ressource **limité au locataire** (par exemple `gkee6a1e84d`)
  même si le KSA réside dans l'espace de noms **limité à l'application**
  (par exemple `woodpeckergkee6a1e84d`). Le sujet `RoleBinding` utilise ce nom
  limité au locataire. Cela a nécessité son propre bloc `provider "kubernetes" {}`
  (`Woodpecker_GKE/provider-auth.tf`) — la propre configuration interne du fournisseur
  Kubernetes de `App_GKE` est privée de ce module et n'est pas
  héritée par le module d'application appelant.
- **Les pods de pipeline s'exécutent dans le propre espace de noms de
  l'agent.** `WOODPECKER_BACKEND_K8S_NAMESPACE` est défini sur l'espace de noms réel de
  l'application du pod, de sorte que l'octroi de RBAC est un `Role`
  limité à l'espace de noms, et non un `ClusterRole` à l'échelle du
  cluster.
- **La configuration de la forge est requise pour démarrer, pas seulement pour
  se connecter.** Confirmé en direct : le serveur se termine fatalement
  ("forge non configurée") si aucune forge n'est définie — ceci est
  différent de certaines autres applications de ce catalogue (par exemple
  Outline) qui démarrent correctement avec zéro fournisseurs d'authentification
  et affichent simplement une page de connexion vide. Les valeurs
  Gitea/Forgejo de substitution (`WOODPECKER_GITEA_URL`, `WOODPECKER_GITEA_CLIENT`,
  `WOODPECKER_GITEA_SECRET` — variables d'environnement simples, non soutenues par
  Secret Manager) permettent au module de se déployer proprement dès la
  sortie de la boîte ; un opérateur doit les remplacer par une véritable
  application OAuth enregistrée sur une instance Gitea/Forgejo réelle après
  le déploiement.
- **Chemin de santé.** Les deux sondes ciblent `GET /healthz`, confirmé en
  direct pour renvoyer `204 No Content`, non authentifié.
- **Ports.** `8000` est le vrai port HTTP (confirmé via
  `docker inspect`) ; `9000` est la connexion gRPC interne de
  l'agent au serveur, jamais exposée via le service Kubernetes puisque les
  deux processus partagent un seul pod.
- **Écriture unique, instance unique.** `max_instance_count` est plafonné à
  `1` au moment de la planification — le serveur de Woodpecker
  n'a pas de coordination multi-instance documentée/vérifiée pour son propre
  état basé sur la base de données.
- **Les mises à jour recréent le pod.** Une augmentation de version
  reconstruit l'image personnalisée (serveur + agent + busybox, regreffés) et
  recrée le pod unique.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Woodpecker sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par
défaut. Voir `modules/Woodpecker_GKE/README.md` pour la référence exhaustive des
entrées, groupe par groupe.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `woodpecker` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Se résout en interne en un `v3.16.0` épinglé — Woodpecker ne publie pas de balise `latest`. |
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `display_name` / `description` | (obsolète, voir §7) | Reste de la source de clonage Immich de ce module — ne pas faire confiance au texte livré ; les valeurs décrivent la gestion photo/vidéo, pas Woodpecker CI. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | Limite de CPU pour le conteneur serveur+agent co-localisé. |
| `memory_limit` | `4Gi` | Limite de mémoire pour le conteneur serveur+agent co-localisé. |
| `container_port` | `8000` | Confirmé via `docker inspect` de l'image réelle étiquetée `v3`. |
| `min_instance_count` | `1` | |
| `max_instance_count` | `1` | **Plafonné par validation au moment de la planification** — voir §3. |
| `enable_cloudsql_volume` | `true` | Sidecar de socket Unix Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `forge_url` | `http://forgejo.example.internal` | Espace réservé. Pointer vers une instance Gitea/Forgejo réelle après le déploiement — voir §6. |
| `forge_client_id` / `forge_client_secret` | `placeholder-client-id` / `placeholder-client-secret` | Identifiants d'application OAuth de substitution. |
| `admin_username` | `admin` | Nom(s) d'utilisateur de la forge ayant les droits d'administrateur Woodpecker lors de la première connexion. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires en texte clair, fusionnés sur les valeurs par défaut de la forge/du backend du module. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées en tant que variables d'environnement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Le déploiement de référence a utilisé `ClusterIP` en raison d'un quota épuisé — voir §6. |
| `workload_type` | `null` | Se résout toujours en `Deployment` pour ce module (pas de cas d'utilisation `stateful_pvc_enabled`). |
| `termination_grace_period_seconds` | `60` | Secondes après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé par ce module — l'état de Woodpecker réside entièrement dans
Cloud SQL, et il n'y a pas d'état de système de fichiers par pod à
persister via un PVC.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Confirmé en direct : `204 No Content`, non authentifié. |
| `uptime_check_config` | désactivé | Si activé, cible `/healthz`. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | La valeur par défaut vide se résout en un seul job `db-init` de `Woodpecker_Common` — Woodpecker migre son propre schéma au démarrage, donc aucun job de migration séparé n'existe. |
| `cron_jobs` | `[]` | CronJobs Kubernetes. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut. Woodpecker CI n'a pas de bibliothèque multimédia et aucune utilité fonctionnelle pour NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `data` par défaut — inutilisé par Woodpecker. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `woodpecker_db` | |
| `db_user` | `woodpecker_user` | |
| `database_type` | `POSTGRES_15` fixe par `Woodpecker_Common` | Miroir inerte sur la propre variable `database_type` de ce module. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une passerelle pour un nom d'hôte personnalisé. |
| `reserve_static_ip` | `true` | Le déploiement de référence a utilisé `false` en raison d'un quota épuisé — voir §6. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Nécessite un domaine personnalisé et les deux identifiants OAuth, validés au moment de la planification. |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Non confirmé comme étant fonctionnellement requis** — le point d'entrée de `Woodpecker_Common` ne lit jamais `REDIS_HOST`/`REDIS_PORT`. Voir §7. |

### Groupes 8, 9, 12, 17, 18, 22 {#groups-8-9-12-17-18-22}

Comportement standard de `App_GKE` — Quota de ressources, Politiques de
fiabilité, CI/CD et Autorisation binaire, Sauvegarde et maintenance, SQL
personnalisé (non applicable), Contrôles de service VPC. Voir
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP / IP du LoadBalancer externe (lorsqu'elle est réservée). |
| `web_url` | Lit `additional_service_urls["web"]` — **résout `null`** sur un déploiement standard, car aucun service supplémentaire `"web"` n'est câblé par défaut. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Identité et détails de connexion Cloud SQL. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` par défaut — inutilisé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (le `db-init` par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs et les combinaisons au moment de la planification. Le propre
> `validation.tf` de `Woodpecker_GKE` rejette en outre
> `max_instance_count > 1` et `enable_iap = true` sans les deux
> identifiants OAuth.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Configuration de la forge (`forge_url`/`forge_client_id`/`forge_client_secret`) | Remplacer les trois par une application OAuth réelle enregistrée sur une instance Gitea/Forgejo réelle après le déploiement | **Élevé** | Le serveur démarre et signale un état sain avec les valeurs de substitution, mais les pipelines ne se déclenchent jamais et la connexion à la forge ne fonctionne jamais — un déploiement qui semble fonctionner mais qui n'est pas réellement utilisable pour la CI. |
| `service_type` / `reserve_static_ip` | `LoadBalancer` / `true` une fois que le quota d'IP externe le permet | **Élevé** | Le déploiement de référence a utilisé `ClusterIP` / `false` uniquement parce que le quota `IN_USE_ADDRESSES` du projet de test était épuisé. Les webhooks de forge (événements push/PR) doivent atteindre ce serveur depuis Internet — un déploiement `ClusterIP` ne peut pas les recevoir et les pipelines ne se déclencheront pas automatiquement. |
| `max_instance_count` | `1` (appliqué au moment de la planification) | **Critique** | Chaque pod exécute un serveur+agent co-localisé ; plus d'une réplique exécuterait plusieurs serveurs sur la même base de données sans coordination vérifiée. |
| Sondes de santé | Laisser en HTTP `/healthz` (valeur par défaut du module) | **Moyen** | `/healthz` est confirmé non authentifié et renvoie `204` ; pointer une sonde vers un point de terminaison authentifié bloquerait le déploiement. |
| `enable_nfs` | Laisser à `false` | **Faible** | Correct par défaut. Le définir sur `true` provisionne un montage NFS inutilisé dans le pod sans effet fonctionnel, et ce n'est pas gratuit. |
| `enable_redis` | Laisser par défaut ; non confirmé comme requis | **Faible** | La description prétend que Redis est "OBLIGATOIRE", mais le point d'entrée de `Woodpecker_Common` ne lit jamais `REDIS_HOST`/`REDIS_PORT` — cela semble être un vestige inerte de la source de clonage du module, non un comportement vérifié de Woodpecker CI. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC et image mirroring — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Woodpecker est décrite dans **[Woodpecker_Common](Woodpecker_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Woodpecker CI sur GKE Autopilot](../labs/Woodpecker_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Woodpecker Common — Configuration d'application partagée](Woodpecker_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Contrôle de version et CI/CD**.
