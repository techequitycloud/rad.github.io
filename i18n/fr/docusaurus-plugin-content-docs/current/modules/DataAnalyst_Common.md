---
title: "DataAnalyst Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Data Analyst Agent — paramètres de la couche application consommés par le déploiement Cloud Run."
---

<!-- translated-from: docs/modules/DataAnalyst_Common.md @ 15fd4c7 sha256:ad8bf2795b31 -->

# DataAnalyst Common — Configuration d'application partagée {#dataanalyst-common--shared-application-configuration}

`DataAnalyst_Common` est la **couche d'application partagée** pour l'agent Data Analyst. Il n'est
pas déployé seul ; il fournit plutôt la configuration spécifique à l'agent sur laquelle
[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md) s'appuie. Les utilisateurs finaux ne configurent jamais cette
couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans le guide de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement l'agent, voir
[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md) et le guide de base
[App_CloudRun](App_CloudRun.md).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par DataAnalyst_Common | Où cela apparaît |
|---|---|---|
| Pas de credential de backend | L'authentification Vertex AI est le compte de service d'exécution propre au service Cloud Run — pas de clé API, pas de mot de passe de base de données | Le seul secret est la clé d'accès visiteur optionnelle ci-dessous |
| Clé d'accès visiteur | Lorsqu'une clé d'accès est requise (`access_control`, par défaut `auto` : sur un projet géré par RAD et accessible publiquement), génère une clé de 32 caractères — ou prend celle que vous fournissez — dans Secret Manager et l'expose comme variable d'environnement secrète `ACCESS_KEY` (le wrapper définit `ACCESS_CONTROL=key`) ; le serveur refuse alors `/upload` et `/ws/chat` sans elle, échouant en mode fermé | Sorties `secret_ids`, `access_key_required`, `generated_access_key` |
| Pas de base de données, pas de bucket | Définit `database_type = NONE` et ne provisionne aucun bucket GCS | Aucune instance Cloud SQL, job d'initialisation ou bucket n'apparaît dans le déploiement |
| Image de conteneur | Construit une image personnalisée (Python, FastAPI + Google ADK) à partir du `Dockerfile` dans `scripts/` | Sortie `container_image` du déploiement de la plateforme |
| Exécution de code en bac à sable | Héberge l'agent ADK, ses outils (`list_uploaded_files`, `inspect_file`, `execute_code`), et le wrapper d'exécution du lanceur de bac à sable | Comportement de l'application dans le guide de la plateforme |
| Stockage de téléchargement éphémère | Chaque fichier téléchargé réside sous `UPLOAD_ROOT/<session_id>/` dans le stockage local du conteneur uniquement | N'apparaît jamais dans aucune ressource Google Cloud durable |
| Vérifications de santé | Fournit des sondes HTTP ciblant `GET /_health` — délibérément pas `/healthz` | §Observabilité dans le guide de la plateforme |

---

## 2. Une histoire à connaître : ce module a été réaffecté {#2-a-history-worth-knowing-this-module-was-re-purposed}

`DataAnalyst_CloudRun`/`DataAnalyst_Common` a commencé comme un conseiller de chat de catalogue de référence qui
clonait le catalogue de modules privés de ce dépôt pour aider un utilisateur à configurer un *autre*
déploiement via le langage naturel. Cette conception a été abandonnée au profit de l'agent d'analyse de données en bac à sable actuel, plus général — un meilleur ajustement pour le lanceur de bac à sable de Cloud Run, dont
la vraie valeur est d'isoler l'**exécution de code arbitraire**, et non la recherche de fichiers en lecture seule. Deux
conséquences qui expliquent les choix que vous verrez ailleurs dans cette documentation :

- **Aucun bucket GCS et aucune étape de git-clone ne subsistent, et l'ancien secret GitHub PAT a disparu.** La
  conception précédente nécessitait les trois (un bucket de cache de dépôt, un GitHub PAT, un `git clone` d'exécution) ; rien de tout cela
  ne s'applique à un module dont la seule "donnée" est ce qu'un utilisateur télécharge.
- **`public_access` est par défaut `true`.** La conception précédente le définissait par défaut `false`, car un
  déploiement en libre-service dans un projet administré par l'*utilisateur final* aurait rendu le catalogue mis en cache et
  cloné trivialement lisible via le propre GCP IAM de cet utilisateur — une découverte réelle et confirmée
  lors de l'examen de cette conception. Cette préoccupation de confidentialité ne s'applique pas à un outil général
  d'analyse de données sans matériel source propriétaire à protéger.

---

## 3. Image de conteneur et build {#3-container-image-and-build}

`DataAnalyst_Common` déclenche toujours un build d'image personnalisé (`image_source = "custom"`). Le
Dockerfile installe `pandas`, `numpy`, `openpyxl` (support Excel) et `matplotlib` (backend Agg, pour les graphiques)
aux côtés de FastAPI et du Google ADK.

matplotlib construit un cache de polices lors de la première importation. Étant donné que les écritures du lanceur de bac à sable sont une
superposition de mémoire isolée et supprimée après chaque appel, ce cache ne pourrait jamais persister d'un
appel `execute_code` à l'autre pour accélérer le suivant — le Dockerfile **le pré-construit donc au moment du build de l'image**
à un chemin fixe (`MPLCONFIGDIR=/opt/mplcache`), et le préambule `execute_code` épingle
`MPLCONFIGDIR` à ce même chemin explicitement avant que le code généré n'importe matplotlib —
ne reposant délibérément pas sur `$HOME` ou d'autres variables d'environnement qui pourraient ne pas survivre dans
le bac à sable plus que `PATH` (voir §4).

```
ARG DATA_ANALYST_VERSION=1.0.0
FROM python:3.11-slim@sha256:...   # digest-pinned for build reproducibility
# ca-certificates (TLS trust for Vertex AI), then requirements.txt,
# then the matplotlib font-cache pre-build, then the agent/frontend code.
```

---

## 4. Le modèle d'exécution en bac à sable {#4-the-sandboxed-execution-model}

Chaque outil qui touche au contenu de fichiers ou exécute du code passe par
`sandbox_exec.run_isolated`, qui invoque le binaire `--sandbox-launcher` de Cloud Run
(`/usr/local/gcp/bin/sandbox do -- <command>`) lorsqu'il est présent, ou la commande directement en dehors de
Cloud Run (développement local).

Propriétés de sécurité confirmées (d'après la documentation du bac à sable de Google, et non pas seulement supposées) :

- **L'accès réseau sortant est refusé par défaut** — aucun appel ici ne demande jamais `--allow-egress`, donc
  le code en bac à sable n'a aucun accès réseau, quoi qu'il tente.
- **Les écritures atterrissent dans une superposition de mémoire isolée, supprimée après l'appel** — rien de ce qu'un script
  écrit (y compris une tentative de modification d'un fichier téléchargé, ou de sauvegarde d'un graphique sur disque) ne persiste.
- **Le processus en bac à sable ne peut pas lire les variables d'environnement de ce service ni atteindre le
  serveur de métadonnées** — sans objet pour les identifiants ici (il n'y en a pas à protéger), mais cela
  s'étend plus loin que prévu : **`PATH` est aussi une variable d'environnement**, donc un nom de commande nu
  (`python3`, `head`) ne peut pas être résolu par `exec()` à l'intérieur du bac à sable. Confirmé
  en direct : chaque appel échouait avec `error finding executable "python3" in PATH []` jusqu'à ce que
  `run_isolated` soit corrigé pour résoudre chaque commande en un chemin absolu (via `shutil.which()`,
  dans le processus *appelant*, qui a un `PATH` normal) avant qu'il n'atteigne le bac à sable.

**Ce que cette limite ne couvre PAS :** l'isolation entre différentes sessions de chat
simultanément actives sur la *même* instance. Les répertoires de session sont nommés avec un
UUID impossible à deviner, mais le processus en bac à sable voit toujours le même système de fichiers de conteneur que le processus principal
— le bac à sable restreint l'accès réseau/écriture/environnement, pas les fichiers sur disque qui sont lisibles. Définissez
`max_concurrent_requests = 1` sur le module de la plateforme si cela est important pour vos
données.

Chaque exécution `execute_code` ajoute également un préambule de limitation des ressources
(`resource.setrlimit` sur `RLIMIT_AS` et `RLIMIT_CPU`) avant l'exécution du code généré,
limité par `execute_code_memory_limit_mb` et le propre délai d'attente de l'appel — confirmé appliqué sur
les conteneurs Linux sur lesquels ce module est déployé (non portable sur toutes les plateformes : `setrlimit` sur
`RLIMIT_AS` est silencieusement rejeté sur macOS, ce qui n'affecte que le développement/test local).

---

## 5. Gestion des téléchargements et livraison des graphiques {#5-upload-handling-and-chart-delivery}

- **Téléchargements.** `POST /upload` valide l'extension du fichier et diffuse le corps, rejetant
  une fois que la limite de taille configurée est dépassée — vérifiée au fur et à mesure de l'arrivée des octets, jamais
  fiée à un `Content-Length` déclaré. Le nettoyage des répertoires de session expirés s'exécute de manière opportuniste à
  chaque téléchargement plutôt que selon un calendrier.
- **Graphiques.** Le code généré par l'agent peut imprimer une ligne de marqueur `CHART_PNG_BASE64:<base64>` ;
  `execute_code` l'extrait de la sortie standard côté serveur et la renvoie comme un champ
  `chart_base64` distinct. Le serveur de chat inspecte directement l'événement de *réponse* d'appel d'outil ADK brut
  et transmet l'image au navigateur comme son propre message WebSocket dès qu'elle apparaît —
  indépendamment de ce que dit la réponse en langage naturel du modèle, car un
  LLM n'est pas toujours fiable pour citer textuellement un blob de plusieurs centaines de Ko.
- **Journalisation structurée.** Chaque appel d'outil émet une ligne JSON vers la sortie d'erreur standard (nom de l'outil, ID de session,
  succès/échec, durée, code de sortie) — Cloud Logging analyse cela automatiquement en champs
  `jsonPayload`/`severity` sans bibliothèque de journalisation ni dépendance ajoutée.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `GET /_health` sur le port du conteneur — public et
non authentifié, car les propres sondes de démarrage/vivacité de Cloud Run doivent l'atteindre. Délibérément
**pas** nommé `/healthz` : confirmé en direct que les requêtes vers ce chemin exact reçoivent un
404 de marque Google avec zéro journal de requête côté conteneur, tandis que tous les autres chemins (y compris
celui-ci) atteignent l'application normalement — le routage de périphérie de Google (GFE) semble
traiter `/healthz` comme un chemin réservé au niveau de l'infrastructure sur au moins certaines surfaces de Cloud Run.

---

Pour la configuration spécifique à l'agent et destinée à l'utilisateur (variables par groupe, sorties et comment
explorer chaque service depuis la Console et la CLI), consultez le guide de la plateforme :
**[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Agent d'analyse de données sur Google Cloud Run](DataAnalyst_CloudRun.md) — cette configuration déployée sur Cloud Run.
