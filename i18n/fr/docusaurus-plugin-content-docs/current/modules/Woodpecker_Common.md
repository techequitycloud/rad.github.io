---
title: "Woodpecker Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Woodpecker CI — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Woodpecker_Common.md @ 3055034 sha256:786c8860a23d -->

# Woodpecker Common — Configuration applicative partagée {#woodpecker-common--shared-application-configuration}

`Woodpecker_Common` est la **couche applicative partagée** de Woodpecker CI. Elle n'est pas déployée seule ; elle fournit la configuration propre à Woodpecker sur laquelle s'appuie [Woodpecker_GKE](Woodpecker_GKE.md). Les utilisateurs finaux ne configurent jamais directement cette couche — elle ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

**GKE uniquement, de manière définitive.** Le backend d'exécution de Woodpecker (`WOODPECKER_BACKEND=kubernetes`) exécute chaque étape de pipeline dans son propre Pod Kubernetes créé dynamiquement, ce qui nécessite un véritable accès à l'API Kubernetes au sein du cluster — Cloud Run n'a aucune API Kubernetes à appeler ni aucun privilège pour docker-in-docker. Il n'existe pas de `Woodpecker_CloudRun` et il n'y en aura pas ; il s'agit de la même catégorie de limite architecturale que pour les autres modules **Common + GKE uniquement** de ce catalogue (Kopia, RocketChat, Immich, Temporal, Prowlarr, VictoriaMetrics, Plausible, LobeChat, Supabase). `Woodpecker_Common` suit la même structure que tous les modules Common de ce catalogue, uniquement par souci de cohérence, et non parce qu'une seconde variante de plateforme existe ou est prévue.

Pour l'infrastructure qui provisionne et exécute effectivement Woodpecker, consultez le guide de la plateforme [Woodpecker_GKE](Woodpecker_GKE.md) et les guides du socle ([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Woodpecker_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé : l'image officielle du serveur, à laquelle sont greffés le binaire de l'agent, un shell statique `busybox:musl` et un point d'entrée cloud ; construite via Cloud Build avec l'ARG de build propre à l'application `WOODPECKER_VERSION` | Sortie `container_image` du déploiement de la plateforme |
| Résolution de version | `application_version = "latest"` est résolu en interne vers une version épinglée `v3.16.0` — Woodpecker ne publie aucun tag `latest` en amont | Tag d'image effectivement déployé |
| Stockage de données | Fixe `database_type = "POSTGRES_15"` | §3 dans le guide de la plateforme |
| Amorçage de la base de données | Le job `db-init` du premier déploiement — rôle, base de données, autorisations. Pas de job de migration distinct : Woodpecker migre automatiquement son propre schéma au démarrage du serveur | Sortie `initialization_jobs` |
| Agent co-localisé | Le binaire de l'agent s'exécute en tant que processus d'arrière-plan dans le même conteneur/pod que le serveur | §Comportement de l'application dans le guide de la plateforme |
| Valeurs provisoires de la forge | Fusionne des valeurs Gitea/Forgejo provisoires dans `environment_variables` pour que le serveur puisse simplement démarrer | §Comportement de l'application dans le guide de la plateforme |
| Secrets | Génère `WOODPECKER_AGENT_SECRET` dans **Secret Manager** — l'identifiant gRPC interne entre le serveur et l'agent co-localisés | Injecté automatiquement ; à récupérer via Secret Manager |
| Vérifications de santé | Sondes de démarrage et d'activité par défaut ciblant HTTP `GET /healthz` (sans authentification, `204 No Content` confirmé) | §Observabilité dans le guide de la plateforme |
| Stockage d'objets | **Aucun** — `storage_buckets = []`. Woodpecker CI ne dépend d'aucun stockage d'objets | Aucun bucket géré par le module |

---

## 2. WOODPECKER_AGENT_SECRET — l'unique secret généré {#2-woodpecker_agent_secret--the-one-generated-secret}

Woodpecker n'est livré avec aucun identifiant intégré que cette couche devrait initialiser. La seule chose qu'elle génère est le secret partagé qui authentifie la connexion gRPC interne entre le serveur et l'agent co-localisés — vérifié par rapport à la configuration de référence docker-compose en amont, les deux processus lisent exactement ce nom de variable :

| Secret | Variable d'environnement | Contenu | Rotation |
|---|---|---|---|
| `secret-<prefix>-<app>-agent-secret` | `WOODPECKER_AGENT_SECRET` | Mot de passe aléatoire de 40 caractères, sans caractères spéciaux | Une valeur stable est requise — le faire tourner indépendamment casserait la connexion de l'agent co-localisé au serveur à chaque redémarrage ultérieur du pod |

```bash
gcloud secrets list --project "$PROJECT" --filter="name~agent-secret"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Cette couche ne génère aucun autre secret applicatif. Les éléments JWT/de session propres à Woodpecker sont entièrement gérés par le serveur lui-même dans sa base de données Cloud SQL.

---

## 3. Image de conteneur : serveur + agent co-localisés {#3-container-image-co-located-server--agent}

Woodpecker livre le serveur et l'agent sous forme de **deux images distinctes** — la référence `docker-compose.yml` en amont exécute deux conteneurs. Cette couche construit à la place UNE seule image personnalisée en greffant le binaire de l'agent sur l'image du serveur :

```
ARG WOODPECKER_VERSION=v3.16.0
FROM woodpeckerci/woodpecker-agent:${WOODPECKER_VERSION} AS agent
FROM busybox:musl AS busybox
FROM woodpeckerci/woodpecker-server:${WOODPECKER_VERSION}

COPY --from=agent /bin/woodpecker-agent /bin/woodpecker-agent
COPY --from=busybox /bin/busybox /busybox/busybox
COPY entrypoint.sh /cloud-entrypoint.sh
RUN ["/busybox/busybox", "--install", "-s", "/busybox"]   # as root
ENV PATH="/busybox:$PATH"

ENTRYPOINT ["/busybox/busybox", "sh", "/cloud-entrypoint.sh"]
CMD ["/bin/woodpecker-server"]
```

**Pourquoi co-localisé, et non un sidecar `additional_services` distinct.** Le mécanisme générique `additional_services` de GKE (utilisé ailleurs dans ce catalogue pour des conteneurs sidecar réellement indépendants) déploie un sidecar sous forme de Deployment propre, sous le ServiceAccount par défaut de l'espace de noms — **et non** sous le ServiceAccount Kubernetes propre à l'application principale. Le backend d'exécution Kubernetes de l'agent doit s'exécuter sous la MÊME identité que celle à laquelle le `Role`/`RoleBinding` RBAC à portée d'espace de noms de `Woodpecker_GKE` accorde effectivement les autorisations de création et de suppression de pods/PVC/Services/Secrets — cette identité est le KSA propre à l'application principale, accessible uniquement en exécutant l'agent dans le propre pod du Deployment principal.

**Pourquoi précisément le `busybox:musl` greffé.** Vérifié via `docker
export` des véritables images du serveur et de l'agent : tout le rootfs se limite au binaire unique plus `/etc/passwd,group,hosts` — réellement distroless, sans aucun shell. Un point d'entrée sous forme de script shell nécessite un shell statique greffé. Le tag par défaut `busybox:stable` est **lié dynamiquement** et échoue avec « no such file or directory » dans ce rootfs dépourvu de libc ; `busybox:musl` est réellement statique (le même correctif déjà établi pour Loki/Headscale ailleurs dans ce catalogue). Copier le binaire `busybox` brut ne suffit pas à lui seul — son aiguillage multi-appels des applets (`sh`, `awk`, ...) ne fonctionne que lorsqu'il est invoqué sous l'un de ces noms d'applet ; le build exécute donc aussi `busybox --install -s /busybox` (en tant que root, avant que l'image ne bascule vers son `USER woodpecker` non root) pour créer les liens symboliques que `entrypoint.sh` appelle réellement.

**Aucun tag `:latest` n'existe en amont, par conception.** Vérifié en conditions réelles : `docker run
woodpeckerci/woodpecker-server:latest` affiche simplement un avis sur le schéma des tags puis se termine — une mesure délibérée contre les mises à niveau majeures accidentelles, et non un bug. L'ARG de build `WOODPECKER_VERSION` du Dockerfile n'est délibérément **pas** l'`APP_VERSION` générique que le socle injecte dans les `build_args` de chaque build personnalisé (qui l'emporte lors de la fusion et forcerait le tag vers un `latest` inexistant) — `local.resolved_version` dans `Woodpecker_Common/main.tf` associe `application_version = "latest"` à une version épinglée `v3.16.0` avant qu'elle n'atteigne le build.

`entrypoint.sh` lance l'agent en tant que processus d'arrière-plan, puis exécute le serveur au premier plan via `exec`, afin qu'il reste le PID 1 pour la gestion des signaux :

```sh
if [ "${1:-}" = "/bin/woodpecker-server" ] || [ "${1:-}" = "woodpecker-server" ]; then
  /bin/woodpecker-agent &
  AGENT_PID=$!
  trap 'kill "$AGENT_PID" 2>/dev/null || true' TERM INT
fi
exec "$@"
```

---

## 4. Amorçage de la base de données — un seul job, pas de migration distincte {#4-database-bootstrap--one-job-no-separate-migration}

Woodpecker nécessite PostgreSQL ; cette couche fixe `database_type =
"POSTGRES_15"`. Lors du premier déploiement, un job ponctuel (`db-init`, `postgres:15-alpine`, délai d'expiration de 600s, 3 nouvelles tentatives) crée de manière idempotente le rôle et la base de données de l'application, accorde les privilèges sur la base de données et sur le schéma `public`, et crée au préalable l'extension `uuid-ossp`.

**Aucun job de migration distinct ne s'exécute.** Vérifié en conditions réelles : le serveur Woodpecker migre automatiquement son propre schéma au démarrage — « Initializing Schema » apparaît automatiquement dans les journaux la première fois qu'il démarre sur une base de données vide. Cela diffère de certaines autres applications de ce catalogue (par ex. Saleor/Payload) qui nécessitent un job de migration dédié avant que le processus serveur puisse démarrer correctement.

---

## 5. Configuration de la forge — requise pour simplement démarrer {#5-forge-configuration--required-just-to-boot}

Le serveur Woodpecker **exige impérativement qu'au moins une forge git soit configurée pour pouvoir démarrer**. Vérifié en conditions réelles : omettre la configuration de la forge provoque un **arrêt fatal** (« forge not configured »), et non une page vide dégradée — contrairement à certaines autres applications de ce catalogue (par ex. Outline) qui démarrent sans problème sans aucun fournisseur d'authentification configuré et affichent simplement une page de connexion vide.

`Woodpecker_Common` fusionne des valeurs Gitea/Forgejo provisoires dans `environment_variables` afin que le module se déploie proprement dès l'installation :

| Variable d'environnement | Source | Rôle |
|---|---|---|
| `WOODPECKER_GITEA` | fixe `"true"` | Active le pilote de forge Gitea/Forgejo |
| `WOODPECKER_GITEA_URL` | `var.forge_url` (par défaut `http://forgejo.example.internal`) | URL de base de l'instance Gitea/Forgejo |
| `WOODPECKER_GITEA_CLIENT` | `var.forge_client_id` (par défaut `placeholder-client-id`) | ID client de l'application OAuth |
| `WOODPECKER_GITEA_SECRET` | `var.forge_client_secret` (par défaut `placeholder-client-secret`) | Secret client de l'application OAuth |
| `WOODPECKER_ADMIN` | `var.admin_username` (par défaut `admin`) | Nom(s) d'utilisateur de la forge auxquels sont accordés les droits d'administration Woodpecker lors de la première connexion |

Ce sont de **simples variables d'environnement, non adossées à Secret Manager** — le même modèle de configuration différée déjà établi pour les valeurs OIDC provisoires d'Outline dans ce catalogue. Un opérateur doit faire pointer `forge_url` vers une véritable instance Gitea/Forgejo (le module `Forgejo_GKE` de ce catalogue convient) et y enregistrer une véritable application OAuth après le déploiement. Tant que ce n'est pas fait, le serveur fonctionne normalement, mais les déclenchements de pipelines et la connexion via la forge ne fonctionnent pas.

---

## 6. Backend d'exécution Kubernetes {#6-kubernetes-execution-backend}

```
WOODPECKER_BACKEND               = "kubernetes"
WOODPECKER_BACKEND_K8S_NAMESPACE = <the pod's own app-scoped namespace>
```

Le backend Kubernetes est la seule option viable dans un pod GKE — vérifié en conditions réelles : le backend par défaut de l'agent, en « détection automatique », échoue purement et simplement sans backend explicitement défini, puisqu'il n'y a ni `docker.sock` ni privilège pour docker-in-docker. Les pods de pipeline s'exécutent dans le **même espace de noms** que l'agent. `Woodpecker_Common` lui-même ne reçoit en entrée que le `resource_prefix` à portée de tenant ; le fichier `woodpecker.tf` de `Woodpecker_GKE` remplace `WOODPECKER_BACKEND_K8S_NAMESPACE` par l'espace de noms réel à portée d'application du pod avant que la configuration n'atteigne le socle, ce qui correspond à l'espace de noms dans lequel le `Role` RBAC qu'il provisionne accorde effectivement les autorisations. Les ressources RBAC `Role` et `RoleBinding` elles-mêmes se trouvent dans `Woodpecker_GKE`, et non ici — elles nécessitent leur propre configuration `provider "kubernetes" {}` (`Woodpecker_GKE/provider-auth.tf`) qu'un module Common n'a aucun moyen de fournir, puisque le fournisseur Kubernetes interne d'`App_GKE` est privé à ce module. Consultez [Woodpecker_GKE §3](Woodpecker_GKE.md#3-woodpecker-application-behaviour) pour la description complète du RBAC, y compris l'ensemble exact de règles (issu du chart Helm officiel de Woodpecker, et non deviné) et la subtilité de nommage entre portée de tenant et portée d'application qui détermine le sujet du `RoleBinding`.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes de démarrage et d'activité émettent toutes deux une requête **HTTP GET `/healthz`**, dont il a été vérifié en conditions réelles qu'elle renvoie `204 No Content`, sans authentification :

- **Sonde de démarrage** — `initial_delay = 30s`, `timeout = 10s`, `period =
  10s`, `failure_threshold = 30`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 10s`, `period =
  30s`, `failure_threshold = 3`.

---

## 8. Ports {#8-ports}

- **`8000`** — HTTP. Le véritable port d'écoute du serveur Woodpecker, vérifié via `docker inspect` de la véritable image taguée `v3`. C'est ce que ciblent `container_port` et le Service Kubernetes.
- **`9000`** — gRPC. La connexion interne de l'agent au serveur co-localisé, authentifiée avec `WOODPECKER_AGENT_SECRET`. Jamais exposé via le Service Kubernetes — les deux processus partagent l'espace de noms réseau d'un même pod.

---

Pour la configuration propre à Woodpecker destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez le guide de la plateforme : **[Woodpecker_GKE](Woodpecker_GKE.md)**. Il n'existe pas de `Woodpecker_CloudRun` — consultez la note en haut de ce guide pour comprendre pourquoi le backend d'exécution Kubernetes le rend définitivement impossible.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md) — cette configuration déployée sur GKE.
