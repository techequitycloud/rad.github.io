---
title: "DataAnalyst Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Data Analyst Agent — paramètres de la couche applicative utilisés par le déploiement Cloud Run."
---

<!-- translated-from: docs/modules/DataAnalyst_Common.md @ 3055034 sha256:392de381847c -->

# DataAnalyst Common — Configuration applicative partagée {#dataanalyst-common--shared-application-configuration}

`DataAnalyst_Common` est la **couche applicative partagée** du Data Analyst Agent. Elle n'est
pas déployée seule ; elle fournit la configuration propre à l'agent sur laquelle s'appuie
[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md). Les utilisateurs finaux ne configurent jamais
cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans le guide de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement l'agent, consultez
[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md) et le guide du socle
[App_CloudRun](App_CloudRun.md).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par DataAnalyst_Common | Où cela apparaît |
|---|---|---|
| Aucun identifiant d'aucune sorte | Ne déclare aucun secret Secret Manager — l'authentification à Vertex AI repose sur le propre compte de service d'exécution du service Cloud Run | Aucun secret n'apparaît dans le déploiement |
| Aucune base de données, aucun bucket | Définit `database_type = NONE` et ne provisionne aucun bucket GCS | Aucune instance Cloud SQL, job d'initialisation ni bucket n'apparaît dans le déploiement |
| Image de conteneur | Construit une image personnalisée (Python, FastAPI + Google ADK) à partir du `Dockerfile` de `scripts/` | Sortie `container_image` du déploiement de la plateforme |
| Exécution de code en bac à sable | Héberge l'agent ADK, ses outils (`list_uploaded_files`, `inspect_file`, `execute_code`) et l'encapsuleur d'exécution du sandbox launcher | Comportement de l'application dans le guide de la plateforme |
| Stockage éphémère des téléversements | Chaque fichier téléversé réside sous `UPLOAD_ROOT/<session_id>/` uniquement dans le stockage local du conteneur | N'apparaît jamais dans aucune ressource Google Cloud durable |
| Contrôles de santé | Fournit des sondes HTTP ciblant `GET /_health` — délibérément pas `/healthz` | §Observabilité dans le guide de la plateforme |

---

## 2. Un historique à connaître : ce module a été réorienté {#2-a-history-worth-knowing-this-module-was-re-purposed}

`DataAnalyst_CloudRun`/`DataAnalyst_Common` a commencé comme un conseiller conversationnel pour un catalogue de référence, qui
clonait le catalogue privé de modules de ce dépôt afin d'aider un utilisateur à configurer un *autre*
déploiement en langage naturel. Cette conception a été abandonnée au profit de l'agent actuel, plus
généraliste, d'analyse de données en bac à sable — mieux adapté au sandbox launcher de Cloud Run, dont
la véritable valeur est d'isoler une **exécution de code arbitraire**, et non une recherche de fichiers en lecture seule. Deux
conséquences expliquent des choix que vous verrez ailleurs dans cette documentation :

- **Il ne reste ni bucket GCS, ni secret Secret Manager, ni étape git-clone.** La conception précédente
  nécessitait les trois (un bucket de cache du dépôt, un PAT GitHub, un `git clone` à l'exécution) ; rien de tout cela
  ne s'applique à un module dont les seules « données » sont celles qu'un utilisateur téléverse.
- **`public_access` vaut `true` par défaut.** La conception précédente le mettait à `false` par défaut, car un
  déploiement en libre-service dans un projet administré par l'*utilisateur final* aurait rendu le catalogue
  cloné et mis en cache lisible sans effort via les propres autorisations IAM GCP de cet utilisateur — une constatation réelle, confirmée
  lors de la revue de cette conception. Ce souci de confidentialité ne s'applique pas à un outil généraliste
  d'analyse de données sans contenu source propriétaire à protéger.

---

## 3. Image de conteneur et build {#3-container-image-and-build}

`DataAnalyst_Common` déclenche toujours le build d'une image personnalisée (`image_source = "custom"`). Le
Dockerfile installe `pandas`, `numpy`, `openpyxl` (prise en charge d'Excel) et `matplotlib` (backend Agg,
pour les graphiques) aux côtés de FastAPI et de Google ADK.

matplotlib construit un cache de polices lors de sa première importation. Comme les écritures du sandbox launcher sont une
surcouche mémoire isolée supprimée après chaque appel, ce cache ne pourrait jamais persister d'un
appel `execute_code` à l'autre pour accélérer le suivant — le Dockerfile le **pré-construit donc au moment du build
de l'image** dans un chemin fixe (`MPLCONFIGDIR=/opt/mplcache`), et le préambule d'`execute_code` fixe
explicitement `MPLCONFIGDIR` sur ce même chemin avant que le code généré n'importe matplotlib —
sans s'appuyer délibérément sur `$HOME` ou d'autres variables d'environnement qui pourraient ne pas survivre dans
le bac à sable, pas plus que `PATH` (voir §4).

```
ARG DATA_ANALYST_VERSION=1.0.0
FROM python:3.11-slim@sha256:...   # digest-pinned for build reproducibility
# ca-certificates (TLS trust for Vertex AI), then requirements.txt,
# then the matplotlib font-cache pre-build, then the agent/frontend code.
```

---

## 4. Le modèle d'exécution en bac à sable {#4-the-sandboxed-execution-model}

Chaque outil qui touche au contenu d'un fichier ou exécute du code passe par
`sandbox_exec.run_isolated`, qui invoque le binaire `--sandbox-launcher` de Cloud Run
(`/usr/local/gcp/bin/sandbox do -- <command>`) lorsqu'il est présent, ou la commande directement en dehors
de Cloud Run (développement local).

Propriétés de sécurité confirmées (d'après la documentation de Google sur les sandboxes, et non simplement supposées) :

- **La sortie réseau est refusée par défaut** — aucun appel ici ne demande jamais `--allow-egress`, si bien que
  le code en bac à sable n'a aucun accès réseau, quoi qu'il tente.
- **Les écritures aboutissent dans une surcouche mémoire isolée, supprimée après l'appel** — rien de ce qu'écrit un script
  (y compris une tentative de modifier un fichier téléversé ou d'enregistrer un graphique sur le disque) ne persiste.
- **Le processus en bac à sable ne peut ni lire les variables d'environnement propres à ce service, ni joindre le
  serveur de métadonnées** — sans objet ici pour les identifiants (il n'y en a aucun à protéger), mais cela
  va plus loin que prévu : **`PATH` est aussi une variable d'environnement**, si bien qu'un nom de commande nu
  (`python3`, `head`) ne peut pas du tout être résolu par `exec()` dans le bac à sable. Confirmé
  en production : chaque appel échouait avec `error finding executable "python3" in PATH []` jusqu'à ce que
  `run_isolated` soit corrigé pour résoudre chaque commande en chemin absolu (via `shutil.which()`,
  dans le processus *appelant*, qui dispose d'un `PATH` normal) avant qu'elle n'atteigne le bac à sable.

**Ce que cette frontière NE couvre PAS :** l'isolation entre différentes sessions de discussion
actives simultanément sur la *même* instance chaude. Les répertoires de session portent un UUID
impossible à deviner, mais le processus en bac à sable voit toujours le même système de fichiers du conteneur que le processus
principal — le bac à sable restreint l'accès au réseau, aux écritures et à l'environnement, pas les fichiers du disque qui sont
lisibles. Définissez `max_concurrent_requests = 1` sur le module de la plateforme si cela compte pour vos
données.

Chaque exécution d'`execute_code` ajoute en outre un préambule de limitation des ressources
(`resource.setrlimit` sur `RLIMIT_AS` et `RLIMIT_CPU`) avant l'exécution du code généré,
borné par `execute_code_memory_limit_mb` et par le délai d'expiration propre à l'appel — dont l'application est confirmée sur
les conteneurs Linux sur lesquels ce module se déploie (non portable sur toutes les plateformes : `setrlimit` sur
`RLIMIT_AS` est rejeté silencieusement sur macOS, ce qui n'affecte que le développement et les tests locaux).

---

## 5. Gestion des téléversements et livraison des graphiques {#5-upload-handling-and-chart-delivery}

- **Téléversements.** `POST /upload` valide l'extension du fichier et lit le corps en flux, en le rejetant
  dès que le plafond de taille configuré est dépassé — vérifié au fil de l'arrivée des octets, jamais sur la foi d'un
  `Content-Length` déclaré. Le nettoyage des répertoires de session expirés s'exécute de manière opportuniste à
  chaque téléversement plutôt que selon une planification.
- **Graphiques.** Le code généré par l'agent peut imprimer une ligne marqueur `CHART_PNG_BASE64:<base64>` ;
  `execute_code` l'extrait de stdout côté serveur et la renvoie dans un champ distinct
  `chart_base64`. Le serveur de discussion inspecte directement l'événement brut de *réponse* de l'appel d'outil ADK
  et transmet l'image au navigateur comme message WebSocket distinct dès qu'elle
  apparaît — indépendamment de ce que dit la réponse en langage naturel du modèle, car un
  LLM n'est pas fiable pour recopier mot pour mot un bloc de plusieurs centaines de Ko.
- **Journalisation structurée.** Chaque appel d'outil émet une ligne JSON sur stderr (nom de l'outil, identifiant
  de session, réussite/échec, durée, code de sortie) — Cloud Logging l'analyse automatiquement en champs
  `jsonPayload`/`severity`, sans bibliothèque de journalisation ni dépendance supplémentaire.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `GET /_health` sur le port du conteneur — public et
non authentifié, puisque les propres sondes de démarrage et de vivacité de Cloud Run doivent pouvoir l'atteindre. Délibérément
**pas** nommé `/healthz` : il a été confirmé en production que les requêtes vers ce chemin exact reçoivent une
erreur 404 à l'enseigne de Google sans aucun journal de requête côté conteneur, alors que tous les autres chemins (y compris
celui-ci) atteignent normalement l'application — le routage en périphérie de Google (GFE) semble
traiter `/healthz` comme un chemin réservé, de niveau infrastructure, sur au moins certaines surfaces de Cloud Run.

---

Pour la configuration propre à l'agent destinée aux utilisateurs (variables par groupe, outputs et manière
d'explorer chaque service depuis la console et la CLI), consultez le guide de la plateforme :
**[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Data Analyst Agent sur Google Cloud Run](DataAnalyst_CloudRun.md) — cette configuration déployée sur Cloud Run.
