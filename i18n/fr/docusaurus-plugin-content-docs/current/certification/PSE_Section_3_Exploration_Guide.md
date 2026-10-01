---
title: "Préparation PSE, section 3 : protection des données"
description: "Préparez la section 3 de l'examen Professional Cloud Security Engineer (PSE) — garantie de la protection des données — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PSE_Section_3_Exploration_Guide.md @ cb682e8 sha256:e1131bdae133 -->

# Guide de préparation à la certification PSE : Section 3 — Garantie de la protection des données (Ensuring data protection) (~23 % de l'examen) {#pse-certification-preparation-guide-section-3--ensuring-data-protection-23-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pse_section3.png" alt="Guide de préparation à la certification PSE : Section 3 — Garantie de la protection des données (~23 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [certification Professional Cloud Security Engineer](https://cloud.google.com/learn/certification/cloud-security-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Ce guide couvre la section 3 de l'examen Professional Cloud Security Engineer. Les modules fondamentaux concernés : `App_Common` (cycle de vie Secret Manager et pipeline de rotation sans interruption de service), `Services_GCP` et `App_Common` (clés de chiffrement gérées par le client avec récupération de clé au moment du plan), et les contrôles TLS/stockage répartis entre `App_CloudRun`, `App_GKE` et la couche de stockage d'objets de la plateforme. Avant de commencer, déployez le profil **secure-platform** avec `enable_cmek = true` ainsi que **guarded-edge** avec `enable_auto_password_rotation = true`.

---

## 3.1 Protection des données sensibles et prévention de la perte de données (Protecting sensitive data and preventing data loss) {#31-protecting-sensitive-data-and-preventing-data-loss}

> ⏱ ~2 h · 💰 faible — versions Secret Manager et un job de rotation · ⚙️ Prérequis : guarded-edge (`enable_auto_password_rotation = true`) ; tout déploiement adossé à une base de données

**Pourquoi l'examen s'y intéresse** — L'examen teste l'hygiène des secrets de bout en bout : jamais dans le code, en clair dans des variables d'environnement ou dans l'état Terraform ; accès au moindre privilège par secret ; rotation automatisée sans interruption de service ; et une piste d'audit défendable. Il teste également la restriction de l'accès aux services de données (BigQuery, Cloud Storage, Cloud SQL), la protection des métadonnées des instances de calcul, et Sensitive Data Protection (anciennement Cloud DLP) pour la découverte et l'anonymisation des données personnelles — que les modules ne mettent pas en œuvre.

**Comment RAD le met en œuvre** — la couche Secret Manager de la plateforme :
- Le mot de passe de la base de données est généré aléatoirement (`database_password_length`, `32` par défaut, plage 16–64) et stocké sous `secret-{instance}-{service}`. L'accès des charges de travail se fait par `roles/secretmanager.secretAccessor` accordé par secret. Les applications consomment les secrets par référence : `secret_environment_variables` sur Cloud Run est résolu à l'exécution via une référence de clé de secret ; App_GKE utilise le module complémentaire Secret Manager — une `SecretProviderClass` plus une ressource personnalisée `SecretSync` matérialisent les valeurs Secret Manager dans le Secret Kubernetes référencé par les pods, `secret_propagation_delay` (`30` s par défaut) absorbant le délai de réplication.
- Le jeton CI/CD GitHub est écrit avec `gcloud secrets versions add` dans un provisioner, précisément pour que la valeur en clair **n'entre jamais dans l'état Terraform** — un modèle d'hygiène de l'état qui mérite d'être cité dans les réponses d'examen sur la gestion des secrets en IaC.
- `secret_rotation_period` (`2592000s` par défaut = 30 jours) crée le sujet Pub/Sub `secret-{service}-rotation` et accorde `roles/pubsub.publisher` à l'identité de service Secret Manager, afin que Secret Manager émette lui-même les notifications de rotation selon le calendrier.
- `enable_auto_password_rotation` (`false` par défaut ; une validation au moment du plan exige une base de données) déploie le gestionnaire complet : déclencheur Eventarc → service Cloud Run `pw-rotator-dispatcher` → job Cloud Run `{prefix}-pw-rotator`. Le flux à double version sans interruption de service du job : enregistrer la version ENABLED actuelle → générer un nouveau mot de passe aléatoire → `ALTER USER` sur Cloud SQL (effectif immédiatement) → ajouter une nouvelle version du secret (pour que `latest` serve la nouvelle valeur) → attendre `rotation_propagation_delay_sec` (`90` par défaut) → désactiver (et non détruire) l'ancienne version, conservée pour le retour arrière et l'audit.

Protection côté magasins de données : Cloud SQL n'utilise qu'une IP privée, en mode SSL chiffré uniquement ; Redis a AUTH activé, la chaîne AUTH étant stockée dans Secret Manager.

Métadonnées des instances : la seule VM Compute Engine qu'exécute la plateforme, le serveur NFS (`create_network_filesystem` dans `Services_GCP`, `enable_nfs` dans App_CloudRun), est construite à partir d'un modèle d'instance qui définit la clé de métadonnées `enable-oslogin = true` (ainsi l'accès SSH est régi par IAM plutôt que par des clés SSH collées dans les métadonnées), active Shielded VM (démarrage sécurisé, vTPM, surveillance de l'intégrité) et n'a pas d'IP externe. Sur GKE, les charges de travail obtiennent leurs identifiants Google via le serveur de métadonnées Workload Identity plutôt que via les métadonnées du nœud.

**Essayez**
1. Déployez avec la rotation activée. Dans **Console > Security > Secret Manager**, ouvrez `secret-{instance}-{service}` → **Versions** : notez l'historique des versions et les paramètres de rotation (date de la prochaine rotation, sujet).
2. Déclenchez et observez une rotation sans attendre 30 jours :
```bash
gcloud run jobs execute <prefix>-pw-rotator --region us-central1 --wait
gcloud secrets versions list secret-<instance>-<service> \
  --format="table(name, state, createTime)"
```
3. Vous devriez voir une nouvelle version ENABLED et la précédente DISABLED. Vérifiez que l'application continue de servir le trafic pendant la bascule (la fenêtre à double version plus l'attente de propagation couvrent les connexions en cours).
4. Auditez qui a accédé au secret (nécessite `enable_audit_logging = true`) :
```bash
gcloud logging read 'protoPayload.serviceName="secretmanager.googleapis.com" AND protoPayload.methodName:"AccessSecretVersion"' \
  --limit=10 --format="table(timestamp, protoPayload.authenticationInfo.principalEmail)"
```
5. Vous savez que cela a fonctionné lorsque le tableau des versions montre l'historique à double version et que le journal d'accès aux données désigne le SA de la charge de travail comme seul lecteur du contenu.

**Testez-vous**
<details>
<summary>Q1 : Scénario — pendant la rotation du mot de passe, les utilisateurs ne doivent constater aucun échec de connexion. Ordonnez correctement les étapes et expliquez le choix d'ordre déterminant.</summary>

R : Générer le nouveau mot de passe → mettre à jour l'utilisateur de la base de données (`ALTER USER`) → ajouter la nouvelle version Secret Manager → attendre un délai de propagation → désactiver l'ancienne version. Le choix déterminant : la base de données est mise à jour *avant* la version du secret, et l'ancienne version n'est désactivée qu'*après* la propagation — pendant cette fenêtre, l'ancien identifiant (en cache) comme le nouveau permettent de s'authentifier, si bien qu'aucun client n'échoue. Désactiver (et non détruire) l'ancienne version préserve le retour arrière.
</details>

<details>
<summary>Q2 : Pourquoi la fonctionnalité de rotation de Secret Manager, à elle seule, ne fait-elle tourner aucun secret ?</summary>

R : La `rotation` d'un secret ne fait que publier une notification Pub/Sub selon le calendrier. Quelque chose doit la consommer et effectuer le changement — ici, Eventarc déclenche le dispatcher, qui exécute le job de rotation. L'examen adore cette distinction : calendrier de rotation = notification ; gestionnaire de rotation = votre code.
</details>

<details>
<summary>Q3 : Un collègue propose de déclarer directement dans Terraform les versions de secrets Secret Manager pour des jetons d'API. Quel est le risque, et quelle est l'alternative déployée ?</summary>

R : Cette ressource stocke le contenu en clair dans l'état Terraform — quiconque a accès à l'état (ou à un fichier d'état commité) lit le secret. Le module pousse plutôt la valeur avec `gcloud secrets versions add` dans un provisioner, de sorte que seule une empreinte non réversible est conservée dans l'état et que les charges de travail lisent le secret par son ID à l'exécution.
</details>

**Au-delà des modules** — Sensitive Data Protection (Cloud DLP) n'est pas mis en œuvre : étudiez l'inspection par infoType de Cloud Storage/BigQuery, l'anonymisation (masquage, tokenisation `CryptoDeterministicConfig`, chiffrement préservant le format avec `CryptoReplaceFfxFpeConfig`) et l'acheminement des résultats vers SCC. Commande de test : `gcloud dlp inspect-templates create`, ou inspectez une chaîne via l'API : `gcloud alpha dlp text inspect --content="My SSN is 123-45-6789" --info-types=US_SOCIAL_SECURITY_NUMBER` (ou utilisez la console **Security > Sensitive Data Protection**). Étudiez aussi la sécurité au niveau des colonnes et le masquage dynamique des données de BigQuery — la plateforme ne comporte aucun BigQuery — ainsi que la protection des métadonnées des instances : `block-project-ssh-keys`, pourquoi OS Login l'emporte sur les clés SSH dans les métadonnées, l'exigence de l'en-tête `Metadata-Flavor: Google`, et l'interdiction de stocker des secrets dans les métadonnées ou les scripts de démarrage.

**⚠️ Piège d'examen** — Les versions de secret `DISABLED` peuvent être réactivées ; les versions `DESTROYED` sont perdues à jamais. Les gestionnaires de rotation doivent désactiver, et non détruire, la version précédente tant que la nouvelle n'a pas fait ses preuves — exactement ce que fait le job de rotation.

---

## 3.2 Gestion du chiffrement au repos, en transit et en cours d'utilisation (Managing encryption at rest, in transit, and in use) {#32-managing-encryption-at-rest-in-transit-and-in-use}

> ⏱ ~2 h · 💰 faible — quelques versions de clés KMS par mois · ⚙️ Prérequis : secure-platform (`enable_cmek = true`)

**Pourquoi l'examen s'y intéresse** — Vous devez choisir le bon niveau de gestion des clés (chiffrement par défaut de Google → CMEK → Cloud HSM → Cloud EKM/Hold-Your-Own-Key) pour une exigence de conformité, comprendre la sémantique de la rotation (les nouvelles versions chiffrent ; les anciennes déchiffrent toujours), les transitions d'état des clés (`ENABLED`/`DISABLED`/`DESTROY_SCHEDULED`/`DESTROYED`) et l'effacement cryptographique (crypto-shredding).

**Comment RAD le met en œuvre** —
- **Au repos, CMEK** (`enable_cmek`, `false` par défaut) : trousseau de clés `cmek-{prefix}` (créé de manière idempotente, car les trousseaux ne peuvent pas être supprimés) avec trois clés de chiffrement symétrique — `cloudsql-{prefix}-key`, `artifactregistry-{prefix}-key`, `storage-{prefix}-key` — chacune tournant selon `cmek_key_rotation_period` (`7776000s` par défaut, 90 jours). Chaque identité de service (Cloud SQL, AlloyDB, Artifact Registry ; l'agent de service GCS) reçoit `roles/cloudkms.cryptoKeyEncrypterDecrypter` **sur la clé concernée**, et non sur le projet.
- **CMEK au niveau applicatif** : découvre le trousseau de Services_GCP ou crée `{project_id}-cmek-keyring`, gère les clés connues `storage-key` et `artifact-registry-key`, et attend ~60 s la propagation IAM avant de chiffrer les buckets/dépôts.
- **Récupération des clés au moment du plan** (un script de récupération des clés s'exécute à chaque plan) : si la version de clé désignée est programmée pour destruction, elle est restaurée ; si elle est désactivée, elle est réactivée ; si elle est absente, elle est créée — le script renvoie un état de clé `enabled|restored|created|skipped`. Une vérification associée réaffirme l'attribution KMS de l'agent de service GCS. La clé de signature de Binary Authorization bénéficie du même traitement de restauration et de réactivation.
- **En transit** : les certificats gérés par Google de Certificate Manager terminent TLS au niveau de l'équilibreur de charge HTTPS global, avec des redirections permanentes HTTP→HTTPS ; Cloud SQL impose le mode SSL chiffré uniquement (PostgreSQL) ; le sidecar Cloud SQL Auth Proxy fournit des connexions de base de données encapsulées dans du mTLS sur GKE.
- **En cours d'utilisation** : non mis en œuvre (pas de Confidential VMs / Confidential GKE Nodes).
- **Stratégies de cycle de vie des objets** : le bucket de sauvegarde porte une règle de cycle de vie Cloud Storage qui supprime les objets plus anciens que `backup_retention_days` (App_CloudRun et App_GKE), et chaque entrée de `storage_buckets` accepte des `lifecycle_rules` (suppression ou changement de classe de stockage selon l'âge, le nombre de versions et d'autres conditions similaires).

**Essayez**
1. Dans **Console > Security > Key Management**, ouvrez le trousseau `cmek-{prefix}` ; vérifiez la période de rotation et la prochaine date de rotation de chaque clé, ainsi que les attributions IAM par clé dans le volet **Permissions**.
```bash
gcloud kms keys list --keyring=cmek-<prefix> --location=us-central1 \
  --format="table(name, purpose, rotationPeriod, primary.state)"
gcloud kms keys get-iam-policy cloudsql-<prefix>-key \
  --keyring=cmek-<prefix> --location=us-central1
gcloud sql instances describe <instance> --format="value(diskEncryptionConfiguration.kmsKeyName)"
```
2. Testez le chemin de récupération : désactivez la version de la clé de stockage (`gcloud kms keys versions disable 1 --key=storage-key --keyring=<keyring> --location=us-central1`), puis lancez un plan/redéploiement depuis le portail — la vérification de récupération des clés de la plateforme au moment du plan la réactive avant toute opération sur les buckets ; recherchez dans le journal du plan un état de clé `restored`/`enabled`.
3. Vous savez que cela a fonctionné lorsque l'instance Cloud SQL indique le nom de votre clé CMEK et que la version de clé désactivée est de nouveau ENABLED après le plan suivant.

**Testez-vous**
<details>
<summary>Q1 : Scénario — une autorité de réglementation exige que vous puissiez rendre toutes les données clients irrécupérables sur demande (« crypto-shredding »). Comment la conception CMEK déployée y répond-elle, et quelle est l'étape irréversible ?</summary>

R : Toutes les données Cloud SQL/GCS/AR sont chiffrées avec des clés gérées par le client. Désactiver les versions de clés rend les données immédiatement inaccessibles, mais de façon réversible ; programmer la destruction (`gcloud kms keys versions destroy`) et laisser s'écouler la fenêtre d'attente de 24 heures ou plus détruit le matériel de clé, rendant définitivement irrécupérable chaque octet chiffré avec lui — sauvegardes comprises. La destruction de la version de clé est l'étape irréversible.
</details>

<details>
<summary>Q2 : Après que la rotation automatique a créé la version de clé 5, les données chiffrées avec la version 2 peuvent-elles encore être lues ?</summary>

R : Oui. La rotation change la version *principale* utilisée pour les nouveaux chiffrements ; le texte chiffré existant reste déchiffrable par sa version d'origine tant que celle-ci reste activée. C'est pourquoi c'est la désactivation ou la destruction des *anciennes* versions, et non la rotation elle-même, qui coupe l'accès aux anciennes données.
</details>

<details>
<summary>Q3 : La création d'une instance Cloud SQL échoue avec « Cloud KMS key is disabled, destroyed, or scheduled to be destroyed. » Que fait la plateforme face à cette catégorie d'échec, et que répondriez-vous à l'examen ?</summary>

R : La sonde `data "external"` de la plateforme, exécutée au moment du plan, restaure les versions `DESTROY_SCHEDULED` et réactive les versions `DISABLED` avant que les ressources dépendantes ne soient modifiées. La réponse attendue à l'examen : restaurer la version de clé (possible uniquement pendant la fenêtre de destruction programmée) ou la réactiver, et vérifier que l'agent de service détient toujours `roles/cloudkms.cryptoKeyEncrypterDecrypter` sur la clé.
</details>

**Au-delà des modules** — Non mis en œuvre : le choix entre clés logicielles et matérielles (clés logicielles Cloud KMS par opposition au niveau de protection Cloud HSM, FIPS 140-2 niveau 3 — `--protection-level=hsm` à la création de la clé), Cloud EKM (clés conservées entièrement hors de Google), les clés de chiffrement fournies par le client (CSEK), l'importation de clés (jobs d'importation pour apporter votre propre matériel de clé), la révocation explicite des clés par désactivation ou destruction de versions, Confidential Computing (Confidential VMs AMD SEV / Confidential GKE Nodes), et le chiffrement côté client/au niveau applicatif (par ex. Tink). Commandes de test : `gcloud kms keys create hsm-key --keyring=KR --location=L --purpose=encryption --protection-level=hsm` et `gcloud compute instances create cvm --confidential-compute --maintenance-policy=TERMINATE`.

**⚠️ Piège d'examen** — CMEK ne signifie pas que Google « ne peut pas voir » vos données (la clé réside toujours dans Cloud KMS et c'est l'infrastructure de Google qui effectue les opérations cryptographiques) ; cela signifie que *vous* contrôlez le cycle de vie de la clé et l'IAM. Seul Cloud EKM (gestionnaire de clés externe) conserve le matériel de clé hors de Google — choisissez EKM pour les scénarios du type « le fournisseur ne doit jamais détenir la clé ».

---

## 3.3 Sécurisation des charges de travail d'IA (Securing AI workloads) {#33-securing-ai-workloads}

> ⏱ ~30 min (lecture) · 💰 sans objet · ⚙️ Prérequis : rien à déployer — concept uniquement

**Pourquoi l'examen s'y intéresse** — L'examen PSE actuel inclut la sécurisation des systèmes d'IA/ML : les menaces propres aux modèles (injection de prompt, empoisonnement des données d'entraînement, inversion/extraction de modèle), les services de garde-fous (Model Armor), l'anonymisation des données d'entraînement, le partage des responsabilités IaaS/PaaS pour l'infrastructure d'entraînement, et les contrôles de sécurité de Gemini Enterprise Agent Platform.

**Comment RAD le met en œuvre** — Aucun contrôle propre à l'IA (Model Armor, Gemini Enterprise Agent Platform, Vertex AI) n'est mis en œuvre par les modules. Le catalogue déploie toutefois des applications d'IA auto-hébergées sur les modules fondamentaux — par exemple `Ollama_CloudRun` (CPU uniquement) et `Ollama_GKE` (pool de nœuds GPU NVIDIA L4 facultatif) pour le service de modèles, avec les poids des modèles dans un bucket Cloud Storage, ainsi que des passerelles et interfaces d'IA comme `LiteLLM_CloudRun`, `OpenWebUI_CloudRun` et `AnythingLLM_CloudRun` — et ces applications héritent des contrôles génériques ci-dessous ; le choix entre Cloud Run et GKE est une version à petite échelle de la question de responsabilité PaaS/IaaS. L'élément le plus proche : chaque contrôle générique présenté ici protège aussi le chemin de service d'une charge de travail d'IA — l'analyse des vulnérabilités d'Artifact Registry pour les images de serveurs de modèles, Binary Authorization pour des conteneurs d'inférence attestés, VPC-SC autour du stockage et des API contenant les données d'entraînement, CMEK sur les buckets qui contiendraient les artefacts de modèles, et IAP/Cloud Armor devant les points de terminaison d'inférence.

**Essayez**
1. Les modules n'ajoutent aucun contrôle propre à l'IA ; répétez plutôt le modèle de périmètre que vous réutiliseriez (dans un projet qui vous appartient, puisque VPC-SC n'est pas proposé dans un projet géré par RAD) : vérifiez que `storage.googleapis.com` (données d'entraînement) et `artifactregistry.googleapis.com` (images de modèles) figurent dans la liste des services restreints du périmètre déployé.
```bash
POLICY=$(gcloud access-context-manager policies list --organization=ORG_ID --format="value(name)")
gcloud access-context-manager perimeters dry-run describe vpcsc_<prefix>_perimeter \
  --policy=$POLICY --format="yaml(spec.restrictedServices)"
```
2. Vous savez que vous avez assimilé la correspondance lorsque vous pouvez dire quel contrôle déployé couvrirait `aiplatform.googleapis.com` s'il était ajouté à un périmètre (le même mécanisme niveau d'accès + service restreint).

**Testez-vous**
<details>
<summary>Q1 : Scénario — un LLM interne affiné renvoie parfois des numéros de téléphone d'employés issus de ses données d'entraînement. Quels sont les deux contrôles Google Cloud qui répondent à ce problème, et à quelle étape ?</summary>

R : L'anonymisation du corpus d'entraînement par Sensitive Data Protection *avant* l'affinage (elle empêche la mémorisation des données personnelles), et les filtres de réponse de Model Armor sur le chemin de service, pour détecter et bloquer les fuites de données personnelles dans les sorties. IAM et VPC-SC n'y peuvent rien — la fuite passe par des réponses légitimes du modèle.
</details>

<details>
<summary>Q2 : Qu'est-ce qui change dans vos responsabilités de sécurité entre un entraînement sur des GPU Compute Engine (IaaS) et Vertex AI Training (PaaS) ?</summary>

R : En IaaS, vous êtes responsable du durcissement de l'OS (Shielded VM), de l'application des correctifs, des contrôles contre le mouvement latéral entre nœuds (pas d'IP externe, règles de pare-feu), en plus des contrôles sur les données et l'IAM. En PaaS, Google exploite les nœuds ; votre périmètre se réduit aux rôles IAM de Vertex AI, à CMEK sur les artefacts, à VPC-SC sur l'API Vertex AI et aux points de terminaison privés. C'est la même logique de réduction de la responsabilité partagée qu'entre GKE Standard et Autopilot.
</details>

**Au-delà des modules** — À étudier : les modèles Model Armor (filtres contre l'injection de prompt, le jailbreak et les données personnelles pour les points de terminaison Gemini et Vertex) ; les contrôles de sécurité de Gemini Enterprise Agent Platform (identité et IAM pour les agents et les personnes qui les utilisent, données que les connecteurs permettent à un agent d'atteindre, VPC-SC, CMEK et journalisation d'audit — consultez la documentation produit en vigueur, car la dénomination est récente) ; les contrôles de sécurité de Vertex AI (CMEK, prise en charge de VPC-SC, points de terminaison Private Service Connect, rôles granulaires comme `roles/aiplatform.user`) ; et l'OWASP Top 10 for LLM Applications. Commandes de test : `gcloud ai models list --region=us-central1`, et consultez la page Model Armor dans la console.

**⚠️ Piège d'examen** — L'injection de prompt est un problème de *validation des entrées* à la frontière du modèle ; les WAF comme Cloud Armor ne peuvent pas analyser sémantiquement les prompts. Les réponses qui greffent un WAF sur un point de terminaison de LLM pour bloquer les jailbreaks sont des distracteurs — c'est Model Armor (ou des garde-fous équivalents) qui constitue le bon contrôle.
