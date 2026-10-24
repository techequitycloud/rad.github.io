---
title: "Agent Data Analyst sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de l'agent Data Analyst sur Google Cloud Run avec le module RAD — variables, architecture, exécution de code en sandbox et opérations."
---

<!-- translated-from: docs/modules/DataAnalyst_CloudRun.md @ e69407af sha256:fed2ba77ade3 -->

# Agent Data Analyst sur Google Cloud Run {#data-analyst-agent-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DataAnalyst_CloudRun.png" alt="Agent Data Analyst sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

L'agent Data Analyst permet à un utilisateur de télécharger un petit fichier de données (CSV, TSV, JSON, texte brut ou Excel) et de poser des questions à son sujet en langage clair. Contrairement à un assistant de chat typique, il ne devine jamais : il écrit du vrai Python (pandas/numpy/matplotlib) et l'exécute — isolé dans le [lanceur de sandbox](https://docs.cloud.google.com/run/docs/configuring/services/sandboxes) de Cloud Run (gVisor) — pour calculer la réponse réelle, et peut renvoyer un véritable graphique avec son explication. Ce module déploie l'agent sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que l'agent utilise et sur la manière de les explorer et de les opérer depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte DataAnalyst sur RAD, et comment cela se compare {#what-dataanalyst-costs-on-rad-and-how-that-compares}

**DataAnalyst sur le module Cloud Run de RAD coûte environ 17,58 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).** DataAnalyst est un agent basé sur ADK qui écrit et exécute du vrai Python sur un fichier de données téléchargé, en sandbox dans Cloud Run.

Si DataAnalyst n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les 17,58 $ US deviennent quelques dollars par mois à la place. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **17,58 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **3 crédits par jour**, environ 90 par mois (environ 9 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 17,58 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'y a pas d'offre d'hébergement géré comparable à mentionner ici ; la comparaison honnête est **ce qui est géré pour vous** — sauvegardes, environnement d'exécution en sandbox, Secret Manager et surveillance — plutôt qu'un prix affiché, puisque le module s'exécute sans serveur et se met à l'échelle à zéro entre les requêtes.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes monétaires — ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : correctifs, sauvegardes, secrets et surveillance, plus la possibilité de mettre en pause DataAnalyst gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si DataAnalyst s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à DataAnalyst dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne supprime pas les ressources Cloud Run une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas un rebuild.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas un rebuild, et une mise à jour ne facture plus jamais les frais de module. Cela représente une poignée de crédits (moins de 1 $ US) au total pour une chaîne DataAnalyst typique, contre les 80 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 17,58 $ US.** Déployez DataAnalyst, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures pendant lesquelles il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé DataAnalyst et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si DataAnalyst resterait inutilisé pendant environ 14 jours ou plus dans votre propre projet (0,59 $ US par jour), ou environ 25 jours ou plus dans un projet géré par RAD (3 crédits par jour).
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python (FastAPI + Google ADK) ; autoscaling basé sur les requêtes par défaut |
| Modèle d'IA | Vertex AI (Gemini) | Pas de secret de clé API à gérer — utilise le compte de service d'exécution du service Cloud Run lui-même, auquel est accordé `roles/aiplatform.user` |
| Exécution de code | Lanceur de sandbox de Cloud Run | Isolé par gVisor : egress réseau refusé par défaut, écritures ignorées après chaque appel, pas d'accès aux variables d'environnement de ce service |
| Données téléchargées | Stockage de conteneur éphémère | Pas de base de données ni de bucket GCS du tout — un fichier ne vit que sous `/tmp/uploads/<session>/` pendant la durée d'une session de chat |
| Réseau | VPC / Egress VPC direct | Déployable de manière autonome (VPC inline) ou convergé sur un réseau `Services_GCP` partagé lorsqu'il en existe un dans le projet |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; Identity-Aware Proxy fortement recommandé (voir ci-dessous) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de credential backend.** L'agent n'a pas de clé API ni de mot de passe de base de données — l'authentification Vertex AI est entièrement l'identité d'exécution du service Cloud Run lui-même. Le seul secret Secret Manager qu'il peut contenir est la clé d'accès visiteur décrite ci-dessous.
- **`public_access` par défaut à `true`.** Contrairement à la plupart des modules du catalogue, celui-ci n'a pas de matériel de référence propriétaire à protéger (il a commencé sa vie comme conseiller de chat de catalogue de référence et a ensuite été réaffecté en agent d'exécution de code en sandbox à usage général — voir [DataAnalyst_Common](DataAnalyst_Common.md) pour cette histoire), il n'y a donc aucune raison de confidentialité de restreindre qui peut le déployer en libre-service.
- **Le lanceur de sandbox EST la limite de sécurité, pas une commodité.** Chaque appel d'outil d'exécution de code/prévisualisation de fichier passe par lui. La désactivation de `enable_sandbox_launcher` supprime entièrement l'isolation des processus — ce n'est pas un bouton de performance.
- **Chaque exécution `execute_code` a son propre plafond de mémoire/CPU** (`execute_code_memory_limit_mb`, 512 MiB par défaut), indépendant et inférieur au `memory_limit` global du conteneur — une allocation incontrôlée échoue proprement avec `MemoryError` plutôt que de menacer l'ensemble de l'instance.
- **Les graphiques sont livrés par le serveur, non confiés au modèle.** L'agent peut générer un graphique matplotlib ; l'image est extraite directement de la réponse de l'appel d'outil et poussée vers le navigateur comme son propre message — jamais utilisée pour survivre intacte dans la propre réponse en langage naturel du modèle.
- **Pas d'isolation stricte entre les sessions de chat concurrentes sur une instance chaude.** Les répertoires de session sont nommés avec un UUID impossible à deviner, mais c'est une limite souple, pas au niveau du système d'exploitation — voir §3 et §6.
- **`min_instance_count` par défaut à `0`** (mise à l'échelle à zéro) ; le démarrage à froid est rapide car il n'y a pas de dépôt à cloner et pas de connexion à la base de données à établir.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service d'agent {#a-cloud-run--the-agent-service}

L'agent s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic. Notez que `max_concurrent_requests` est appliqué via une échappatoire `gcloud beta run services
update` après la création du service (App_CloudRun n'a pas de remplacement de concurrence de première classe) — confirmez qu'il a pris effet :
```bash
gcloud run services describe <service-name> --region "$REGION" \
  --format='value(spec.template.spec.containerConcurrency)'
```

### B. Vertex AI — le backend du modèle {#b-vertex-ai--the-model-backend}

L'agent appelle Gemini via Vertex AI en utilisant le compte de service d'exécution du service Cloud Run lui-même — il n'y a pas de clé API à créer, stocker ou faire pivoter.

- **Console :** Vertex AI → Model Garden, ou vérifiez IAM pour l'octroi `roles/aiplatform.user` sur le compte de service d'exécution.
- **CLI :**
  ```bash
  gcloud projects get-iam-policy "$PROJECT" \
    --flatten="bindings[].members" \
    --filter="bindings.role:roles/aiplatform.user"
  ```

### C. Lanceur de sandbox de Cloud Run — isolation de l'exécution de code {#c-cloud-runs-sandbox-launcher--code-execution-isolation}

Pas une ressource que vous parcourez dans la console, mais le mécanisme central que ce module existe pour utiliser. Appliqué après le déploiement via une échappatoire `gcloud beta` (`--sandbox-launcher`, aucun champ Terraform de première classe n'existe encore pour cela — voir `enable_sandbox_launcher`).

- **Confirmer qu'il est appliqué :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(metadata.annotations)'
  ```
- **Confirmer qu'il isole réellement les appels réels** — recherchez les lignes `[start]`/`[end] exit_code=...` dans Cloud Logging autour d'une interaction de chat réelle :
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>" textPayload:"sandbox"' \
    --project "$PROJECT" --freshness=10m --order=asc
  ```

Les sandboxes Cloud Run sont une fonctionnalité en **préversion publique** — le contrat d'invocation exact et la disponibilité sont sujets à modification sans garanties de stabilité de niveau GA.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Si le projet a déjà un déploiement `Services_GCP`, ce module converge vers son VPC partagé au lieu de maintenir son propre réseau inline — voir §6 pour ce que cela signifie lors d'une mise à jour.

- **Console :** Cloud Run (URL du service) ; Réseau VPC → Réseaux VPC / Sous-réseaux.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute networks list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les paramètres d'ingress, l'egress VPC et l'équilibrage de charge.

### E. Cloud Logging et Monitoring — journaux d'appels d'outils structurés {#e-cloud-logging--monitoring--structured-tool-call-logs}

Chaque appel `list_uploaded_files`/`inspect_file`/`execute_code` émet une ligne JSON (nom de l'outil, ID de session, succès/échec, durée, code de sortie) — Cloud Logging analyse cela automatiquement en champs `jsonPayload` et `severity`, sans bibliothèque de journalisation ni dépendance ajoutée.

- **Console :** Logging → Logs Explorer.
- **CLI — requête par champ, pas par texte brut :**
  ```bash
  # every failed execute_code call in the last hour
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>"
    jsonPayload.tool="execute_code" jsonPayload.ok=false' \
    --project "$PROJECT" --freshness=1h

  # a specific session's activity
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>"
    jsonPayload.session_id="<session-id>"' \
    --project "$PROJECT" --freshness=1h --order=asc
  ```

---

## 3. Comportement de l'application {#3-application-behaviour}

- **Flux de travail télécharger-puis-demander, plusieurs fichiers à la fois.** Le contrôle de téléchargement de la page de chat accepte plusieurs fichiers en une seule sélection (téléchargés séquentiellement, un `POST /upload` par fichier), de sorte que l'analyse inter-fichiers (par exemple, joindre deux CSV) ne nécessite pas d'étape "attacher" distincte dans le protocole de chat. Les fichiers sont validés par extension (`allowed_upload_extensions`) et une limite de taille en flux (`max_upload_size_mb`) avant qu'un seul octet ne touche le disque.
- **Stockage éphémère, limité à la session.** Les fichiers téléchargés vivent sous `/tmp/uploads/<session_id>/` pendant la durée d'une session de chat — balayés opportunément la prochaine fois que quelqu'un télécharge sur la même instance, une fois plus anciens que `upload_ttl_seconds`. Un démarrage à froid ou une instance différente commence sans rien de téléchargé.
- **L'agent calcule ; il ne devine pas.** Chaque question non triviale est répondue en écrivant et en exécutant du vrai code (`execute_code`), jamais en raisonnant à partir d'une simple prévisualisation de fichier. Si le code échoue, l'agent lit la trace d'erreur, la corrige et réessaie — visible directement dans les journaux structurés (§2E) comme un appel échoué suivi d'un appel réussi.
- **Génération de graphiques, livrée de manière fiable.** L'agent peut rendre un graphique matplotlib (backend Agg, pas d'affichage nécessaire) en imprimant une ligne de marqueur `CHART_PNG_BASE64:<base64>` depuis l'intérieur de la sandbox ; le serveur l'extrait de la réponse brute de l'appel d'outil et le pousse vers le navigateur comme son propre message image — indépendamment de ce que dit la propre réponse textuelle du modèle, car un LLM n'est pas toujours fiable pour citer textuellement un blob de plusieurs centaines de Ko.
- **Support Excel.** Les fichiers `.xlsx` sont acceptés aux côtés des CSV/TSV/JSON/texte brut (`openpyxl` prend en charge le moteur Excel de pandas).
- **Prévisualisation sensible à la structure pour JSON.** Plutôt qu'une troncature brute d'octets qui pourrait couper un fichier JSON au milieu d'une structure, la prévisualisation de fichier de l'agent renvoie les premiers éléments de liste ou clés de dictionnaire, joliment formatés, ne revenant à une prévisualisation brute que si l'analyse échoue.
- **Plafond de ressources par appel.** Chaque exécution `execute_code` applique sa propre limite de mémoire (`RLIMIT_AS`) et de temps CPU (`RLIMIT_CPU`) avant l'exécution du code généré, limitée par `execute_code_memory_limit_mb` et le propre délai d'attente de l'appel — indépendamment et en dessous du `memory_limit` global du conteneur.
- **Protections contre les abus/coûts.** Une limite de longueur de message par connexion et une limite de débit, plus une limite par instance sur les messages par minute sur chaque connexion (`INSTANCE_MAX_MESSAGES_PER_MINUTE`, 120 par défaut, `0` pour désactiver), limitent la facturation Vertex AI (et le nombre d'exécutions `execute_code`) qu'un appelant peut générer. La limite par connexion seule est contournée en ouvrant une autre connexion ; celle par instance ne l'est pas.
- **Une clé d'accès sur un projet géré par RAD.** Avec `access_control = "auto"` (par défaut), un projet géré par RAD (facturé à RAD) nécessite une **clé d'accès** par déploiement lorsque le service est publiquement accessible (pas de `enable_iap`, ingress non `internal`) ; un projet que vous possédez reste inchangé. Les visiteurs voient une boîte de connexion ; après que la clé a été saisie une fois, le serveur définit un cookie de session signé, `HttpOnly`, `Secure`, `SameSite=Strict` (12 heures). Jusque-là `/upload` et `/ws/chat` répondent 401, et un service mal configuré sans clé utilisable répond 503 — il échoue fermé. Laissez `access_key` vide et une clé de 32 caractères est générée et affichée comme la **sortie `access_key`** (propriétaire et administrateurs uniquement) ; définissez la vôtre (16+ caractères) pour la garder hors de l'onglet Sorties. La modifier entraîne une nouvelle révision et déconnecte tout le monde. La clé est partagée, pas par utilisateur. Un déployeur ne peut pas la désactiver sur un projet géré par RAD ; seul un administrateur le peut. Les scripts l'envoient comme un en-tête `X-Access-Key`, ou `POST /auth` avec `{"key": "..."}` ; `/docs`, `/redoc` et `/openapi.json` ne sont pas servis.
- **Un service ouvert sur un projet géré par RAD est limité en échelle.** IAP ne peut pas être la valeur par défaut (il nécessite un écran de consentement OAuth dans le projet, qu'un projet géré par RAD fraîchement créé n'a pas et ne peut plus être donné par API), donc bien que `enable_iap = false` et `ingress_settings = "all"`, un projet géré par RAD (facturé à RAD) est limité à `max_instance_count <= 2` et `max_concurrent_requests <= 10` — les valeurs par défaut du module — et le plan refuse des valeurs plus grandes. Derrière IAP, avec `ingress_settings = "internal"`, ou dans votre propre projet, il n'y a pas de telle limite.
- **Non disponible dans un projet sandbox ou lab géré par RAD.** Vertex AI n'est pas autorisé dans ces paliers, donc le plan refuse le déploiement d'emblée avec un message indiquant la solution (un projet géré par RAD de développement ou de production, ou votre propre projet GCP).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour `DataAnalyst_CloudRun` sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dataanalyst` | Nom de base pour le service Cloud Run et le dépôt Artifact Registry. |
| `application_display_name` | `Data Analyst Agent` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `1.1.0` | Tag de version de l'image conteneur — à incrémenter à chaque redéploiement de code uniquement, car l'image est référencée par un tag mutable, et non par un digest. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance — marge au-dessus du plancher habituel de 512 Mo de la plateforme, car le chargement d'un fichier téléchargé par pandas/numpy en bénéficie. |
| `min_instance_count` | `0` | Nombre minimum d'instances (0 = mise à l'échelle à zéro). |
| `max_instance_count` | `2` | Nombre maximum d'instances. |
| `execution_environment` | `gen2` | Requis par le lanceur de sandbox. |
| `container_protocol` | `http1` | HTTP/1.1 simple + WebSocket. |
| `timeout_seconds` | `600` | Maintenu généreux car le WebSocket de chat le maintient ouvert pendant un tour. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le VPC. |
| `enable_iap` | `false` | Chaque message ici est un véritable appel Vertex AI ET peut déclencher l'exécution de code. Pas la valeur par défaut car IAP nécessite un écran de consentement OAuth dans le projet ; tant qu'il est désactivé sur un projet géré par RAD, une clé d'accès est requise et l'échelle est limitée (voir ci-dessus). |
| `access_control` | `auto` | `auto` : une clé d'accès est requise sur un projet géré par RAD tant que le service est publiquement accessible, inchangée sur votre propre projet ; `required` : toujours ; `off` : jamais (refusé sur un projet géré par RAD). |
| `access_key` | `""` | Votre propre clé (16+ caractères). Vide en génère une, affichée comme la sortie `access_key`. Changez-la pour la faire pivoter. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Non utilisé par ce module par défaut — l'agent n'a pas de secret propre. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrée clé spécifique à ce module :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `additional_cloudrun_sa_roles` | `["roles/aiplatform.user"]` | Rôles IAM supplémentaires pour le compte de service Cloud Run. **Doit conserver `roles/aiplatform.user`** — le supprimer interrompt chaque message de chat avec une erreur d'autorisation Vertex AI. |

### Groupe 10 — Domaine, CDN et Cloud Armor {#group-10--domain-cdn--cloud-armor}

Options d'équilibrage de charge App_CloudRun standard (`application_domains`, `enable_cdn`,
`enable_cloud_armor`, `admin_ip_ranges`) — voir [App_CloudRun](App_CloudRun.md).

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /_health` | Correspond à la route de santé du serveur FastAPI. Non nommé `/healthz` — confirmé en direct que le routage de périphérie de Cloud Run traite ce chemin exact comme réservé et n'atteint jamais le conteneur. |
| `uptime_check_config` | désactivé | Vérification de disponibilité de Cloud Monitoring. |

### Groupe 15 — Configuration de l'agent Data Analyst {#group-15--data-analyst-agent-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `vertex_region` | `us-central1` | Région Vertex AI servant les appels Gemini de l'agent. |
| `agent_model` | `gemini-2.5-flash` | ID du modèle Gemini utilisé via Vertex AI. |
| `enable_sandbox_launcher` | `true` | La véritable limite de sécurité pour l'exécution de code — voir §1. |
| `max_upload_size_mb` | `20` | Appliqué en diffusant le téléchargement et en rejetant une fois que ce nombre d'octets est arrivé — jamais fiable à partir de la taille déclarée de la requête. |
| `allowed_upload_extensions` | `[".csv", ".tsv", ".json", ".txt", ".xlsx"]` | Extensions acceptées par le point de terminaison de téléchargement. |
| `upload_ttl_seconds` | `3600` | Durée de conservation d'un fichier téléchargé avant l'éligibilité au nettoyage. |
| `execute_code_memory_limit_mb` | `512` | Plafond de mémoire par appel `execute_code` — à maintenir confortablement en dessous de `memory_limit`. |
| `max_concurrent_requests` | `10` | Limite de connexions WebSocket concurrentes par instance — également le bouton à régler sur `1` si la mise en garde d'isolation inter-session (§6) est importante pour vos données. |
| `require_services_gcp_module` | `false` | Ce module n'a pas de dépendance de base de données/NFS/GKE propre, il se déploie donc de manière autonome dans un projet vierge par défaut. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Options App_CloudRun standard (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`,
`organization_id`, `enable_audit_logging`) — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut — ouvrez-la pour discuter avec l'agent. |
| `access_key_required` | Si l'agent exige une clé d'accès. |
| `access_key` | La clé d'accès générée à saisir sur l'écran de connexion (vide si vous avez choisi votre propre clé ou si aucune n'est requise). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `sandbox_launcher_enabled` | Si `--sandbox-launcher` a été appliqué. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `network_name` / `network_exists` | Réseau VPC utilisé, et s'il a été découvert (partagé) plutôt que créé en ligne. |
| `storage_buckets` | Toujours vide — ce module ne provisionne aucun bucket GCS. |
| `monitoring_enabled` | Statut de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_sandbox_launcher` | `true` | Critique | `false` supprime la SEULE isolation entre le code généré par LLM et le reste du conteneur — tout le modèle de sécurité du module dépend de son maintien. |
| `enable_iap` / `access_control` | IAP, ou une clé d'accès, pour tout ce qui dépasse un test rapide | Élevé | Sur votre propre projet avec `access_control = "auto"` et IAP désactivé, le service est ouvert : tout appelant peut générer des factures Vertex AI et des exécutions de code, limitées uniquement par les limites de débit. Définissez `access_control = "required"` ou activez IAP. |
| `execute_code_memory_limit_mb` | confortablement en dessous de `memory_limit` | Élevé | Si elle est définie trop près de (ou au-dessus de) `memory_limit`, une seule allocation pathologique peut toujours menacer l'ensemble de l'instance au lieu d'échouer proprement avec `MemoryError`. |
| `max_concurrent_requests` | `1` pour des données réellement sensibles | Moyen | Les répertoires de session ne sont isolés que par un nom impossible à deviner, pas par une limite de permission au niveau du système d'exploitation — des sessions concurrentes sur une instance chaude peuvent, en principe, lire les fichiers téléchargés les uns des autres. |
| `application_version` | incrémenter à chaque changement de code uniquement | Moyen | L'image est référencée par un tag mutable ; la reconstruction sous le même tag ne crée pas de nouvelle révision, donc un "redéploiement" continue silencieusement de servir l'ancien conteneur. |
| `allowed_upload_extensions` | se limiter aux formats de données uniquement | Moyen | L'élargissement de cette option à des types de fichiers arbitraires étend ce qu'un processus Python en sandbox mais réel peut être invité à analyser. |
| `upload_ttl_seconds` | plus court pour les déploiements publics | Faible | Un TTL long conserve les données téléchargées par un étranger sur le disque de l'instance plus longtemps que nécessaire si l'onglet du navigateur est simplement abandonné. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application partagée (build de conteneur, gestion des téléchargements et modèle d'exécution de code en sandbox) est décrite dans **[DataAnalyst_Common](DataAnalyst_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [DataAnalyst Common — Configuration d'application partagée](DataAnalyst_Common.md) — la configuration partagée par cette cible de déploiement.
