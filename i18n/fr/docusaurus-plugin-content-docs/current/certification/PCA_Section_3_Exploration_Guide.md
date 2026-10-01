---
title: "Préparation PCA, section 3 : concevoir la sécurité et la conformité"
description: "Préparez la section 3 de l'examen Professional Cloud Architect (PCA) — conception pour la sécurité et la conformité — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PCA_Section_3_Exploration_Guide.md @ cb682e8 sha256:1063adbc6e3d -->

# Guide de préparation à la certification PCA : Section 3 — Conception pour la sécurité et la conformité (Designing for security and compliance) (~17,5 % de l'examen) {#pca-certification-preparation-guide-section-3--designing-for-security-and-compliance-175-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pca_section3.png" alt="Guide de préparation à la certification PCA : Section 3 — Conception pour la sécurité et la conformité (~17.5 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

La conception de la sécurité est le domaine où les modules RAD sont les plus riches : des comptes de service dédiés partout, des secrets qui ne touchent jamais l'état Terraform, CMEK avec rotation automatique et même *récupération* automatique des clés, Binary Authorization, VPC Service Controls avec un déploiement volontairement progressif en mode simulation (dry-run), et un accès zero-trust via IAP. Déployez le profil **Sécurité et livraison** de la [Carte des labs](PCA_Certification_Guide.md) par-dessus un déploiement de base. Modules sollicités : `Services_GCP`, `App_CloudRun` (ou `App_GKE`) et les couches de sécurité d'`App_Common` (secrets, IAM, CMEK et VPC-SC).

---

## 3.1 Concevoir pour la sécurité (Designing for security) {#31-designing-for-security}

> ⏱ ~2–3 h · 💰 modéré — les clés KMS et l'équilibreur de charge Cloud Armor ; Binary Authorization et VPC-SC sont gratuits · ⚙️ Prérequis : profil Sécurité et livraison (VPC-SC exige en outre que le projet appartienne à une organisation GCP et que `admin_ip_ranges` ne soit pas vide)

**Pourquoi l'examen s'y intéresse** — Les questions de sécurité du PCA portent sur la conception d'une défense en couches : qui peut agir (IAM, séparation des tâches), comment les données sont protégées (chiffrement au repos/en transit, contrôle CMEK), ce qui peut s'exécuter (intégrité de la chaîne d'approvisionnement), où les données peuvent circuler (périmètres, segmentation réseau) et qui peut atteindre l'application (accès zero-trust). L'examen évalue le choix de la bonne couche pour une exigence — par exemple, la prévention de l'exfiltration de données relève de VPC-SC, pas des règles de pare-feu.

**Comment RAD le met en œuvre**

*Identité et moindre privilège.* Services_GCP crée des comptes de service dédiés par fonction — `cloudrun-sa-{prefix}`, `cloudbuild-sa-{prefix}`, `clouddeploy-sa-{prefix}`, `gke-sa-{prefix}`, `nfs-sa-{prefix}` — jamais le compte de service Compute par défaut. La couche IAM de la plateforme accorde des liaisons limitées aux ressources : `roles/secretmanager.secretAccessor` *par secret* et `roles/storage.objectAdmin` *par bucket*, plus `roles/iam.serviceAccountUser` pour un emprunt d'identité contrôlé par le compte de service de build. Sur GKE, Workload Identity lie un compte de service Kubernetes (KSA) par espace de noms au compte de service GCP via `roles/iam.workloadIdentityUser` — aucun fichier de clé nulle part.

*Secrets.* La couche de secrets de la plateforme génère le mot de passe de base de données de 32 caractères et le stocke dans Secret Manager ; le jeton GitHub est écrit avec `gcloud secrets versions add` précisément pour qu'il n'entre jamais dans l'état du déploiement. `secret_rotation_period` (par défaut `2592000s` = 30 jours) et `enable_auto_password_rotation` (par défaut `false`) pilotent un flux de rotation à double version et sans interruption : un répartiteur déclenché par Eventarc lance un job de rotation qui exécute `ALTER USER`, ajoute la nouvelle version du secret et ne désactive l'ancienne qu'après un délai de propagation.

*Chiffrement.* `enable_cmek` (par défaut `false`) crée un trousseau de clés avec des clés distinctes pour Cloud SQL, Artifact Registry et GCS, avec une rotation tous les `cmek_key_rotation_period` (par défaut `7776000s` = 90 jours), et accorde `roles/cloudkms.cryptoKeyEncrypterDecrypter` à chaque agent de service. Une étape de récupération au moment du plan, dans la couche de stockage d'objets de la plateforme, détecte les versions de clé programmées pour destruction ou désactivées et les restaure avant le provisionnement de toute ressource chiffrée — une auto-réparation opérationnelle face à l'incident classique « quelqu'un a programmé la destruction de la clé ».

*Chaîne d'approvisionnement.* `enable_binary_authorization` (par défaut `false`) avec `binauthz_evaluation_mode` (par défaut `ALWAYS_ALLOW` ; définissez `REQUIRE_ATTESTATION` pour l'appliquer) crée une clé de signature KMS RSA-2048, une note et un attestateur Container Analysis, ainsi qu'une règle additive qui bloque les images non conformes et consigne la décision dans les journaux d'audit. Les clusters GKE appliquent la règle Binary Authorization unique du projet lorsqu'elle est activée. `enable_vulnerability_scanning` active l'analyse d'Artifact Registry.

*Périmètres.* `enable_vpc_sc` (par défaut `false`, `vpc_sc_dry_run` par défaut `true`) construit un périmètre restreignant environ 15 services avec quatre niveaux d'accès (CIDR du VPC, `admin_ip_ranges`, le compte de service IAP, les comptes de service CI/CD). L'ID d'organisation est résolu à partir du projet (une variable `organization_id` permet de le remplacer explicitement dans App_CloudRun/App_GKE — nécessaire lorsque le projet se trouve sous un *dossier*, où la découverte automatique ne renvoie rien), et une sonde de permissions vérifie les droits Access Context Manager de l'appelant, en ignorant l'étape avec un avertissement au lieu de faire échouer l'application.

*Périphérie et exécution.* `enable_iap` accorde `roles/run.invoker` à l'agent de service IAP et `roles/iap.httpsResourceAccessor` à `iap_authorized_users`/`iap_authorized_groups` (une validation en exige au moins un). `enable_cloud_armor` déploie les règles WAF préconfigurées OWASP (sqli/xss/lfi/rce, v33-stable), Adaptive Protection et une limitation de débit de 500 requêtes/min/IP avec un bannissement de 300 s. `application_domains` est facultatif — le module dérive un certificat géré `nip.io` lorsqu'il est vide. Sur GKE, `enable_network_segmentation` (par défaut `false`) crée des NetworkPolicies de type refus par défaut sur Dataplane V2 : entrée uniquement depuis le même espace de noms plus les plages des vérifications d'état des équilibreurs de charge Google et d'IAP ; sortie uniquement vers DNS, HTTPS (y compris les plages googleapis restreintes/privées `199.36.153.4/30` et `199.36.153.8/30`), Cloud SQL sur le port 3307, le serveur de métadonnées et NFS lorsqu'il est activé.

**À vous de jouer**

1. Dans **Console > IAM & Admin > Service Accounts**, listez les cinq comptes de service de la plateforme ; choisissez-en un et examinez ses liaisons :

```bash
gcloud projects get-iam-policy <project-id> \
  --flatten="bindings[].members" \
  --filter="bindings.members:cloudrun-sa-" \
  --format="table(bindings.role)"
```

2. Dans **Console > Security > Secret Manager**, ouvrez le secret du mot de passe de base de données — vérifiez que des versions existent, mais que les valeurs n'apparaissent jamais dans la sortie du plan ni dans le portail.
3. Activez `REQUIRE_ATTESTATION`, puis tentez de déployer une image non signée et observez le refus dans **Console > Logging > Logs Explorer** (filtrez sur les événements d'audit Binary Authorization).
4. Avec VPC-SC activé en mode simulation, examinez le périmètre :

```bash
gcloud access-context-manager perimeters list --policy=<policy-id> \
  --format="table(name,title,spec.restrictedServices.list():label=DRY_RUN_SERVICES)"
```

5. Sur GKE avec la segmentation activée : `kubectl describe networkpolicy -n <namespace>` et rattachez chaque règle à une décision de confiance.
6. Vous savez que cela a fonctionné lorsque l'image non signée est bloquée, que le périmètre apparaît en mode simulation (`spec` renseigné, et non `status`) et que chaque liaison IAM trouvée est limitée à une ressource ou à une fonction précise.

**Testez-vous**
<details>
<summary>Q1 : Un régulateur exige que votre entreprise contrôle — et puisse révoquer — les clés de chiffrement protégeant les données clients, avec une rotation au moins trimestrielle. Quels paramètres de la plateforme y satisfont, et quel risque opérationnel le module atténue-t-il ?</summary>

R : `enable_cmek = true` avec la valeur par défaut `cmek_key_rotation_period = "7776000s"` (90 jours) fournit des clés gérées par le client avec une rotation trimestrielle ; désactiver/détruire la clé révoque l'accès aux données. Le risque opérationnel est un déni de service auto-infligé — une version de clé programmée pour destruction rend inutilisables tous les buckets et dépôts chiffrés —, que l'étape de récupération des clés au moment du plan de la plateforme atténue en restaurant les versions programmées pour destruction ou désactivées.
</details>

<details>
<summary>Q2 : Une équipe sécurité veut garantir que seules les images construites par le pipeline CI officiel s'exécutent en production. Quel contrôle, et dans quel mode ?</summary>

R : Binary Authorization avec `binauthz_evaluation_mode = "REQUIRE_ATTESTATION"` — le pipeline CI signe (atteste) chaque condensé d'image avec la clé KMS, et la règle bloque les images non attestées au moment du déploiement tout en consignant la décision dans les journaux d'audit. L'analyse des vulnérabilités seule ne fait que *signaler* ; IAM seul contrôle qui déploie, pas *ce qui* est déployé.
</details>

<details>
<summary>Q3 : Pourquoi `vpc_sc_dry_run = true` est-il la valeur par défaut, et quelle séquence de déploiement l'examen (et la description de la variable de ce module) attend-il ?</summary>

R : Un périmètre appliqué avec de mauvais niveaux d'accès casse instantanément la CI/CD, les déploiements et l'accès administrateur — les refus de VPC-SC sont des échecs bloquants au niveau de l'API. Séquence correcte : déployer en mode simulation, surveiller pendant plusieurs jours les journaux d'audit à la recherche de violations potentielles, ajouter aux niveaux d'accès les adresses IP/comptes de service manquants, puis passer `vpc_sc_dry_run = false`. Le mode simulation consigne les violations sans bloquer.
</details>

**Au-delà des modules** — Quatre domaines évalués sont absents. (1) **Hiérarchie des ressources et règles d'administration** : dossiers, héritage, contraintes comme `iam.disableServiceAccountKeyCreation` — étudiez « Organization Policy Service » et essayez `gcloud resource-manager org-policies list` dans un projet rattaché à une organisation. (2) **Stratégies de pare-feu hiérarchiques et Cloud NGFW** — les modules n'utilisent que des règles de pare-feu VPC classiques. (3) **Accès distant sécurisé au-delà d'IAP** : Chrome Enterprise Premium (le produit d'accès zero-trust anciennement appelé BeyondCorp Enterprise) et les niveaux d'accès contextuels pour les utilisateurs et les appareils ; le guide de renouvellement mentionne aussi OS Login pour SSH et RDP. (4) **Sécurisation de l'IA** : Model Armor (filtrage des prompts et des réponses contre l'injection de prompts, les jailbreaks et la fuite de données sensibles), Sensitive Data Protection pour découvrir et anonymiser les données personnelles dans les données d'entraînement et d'ancrage, et déploiement sécurisé des modèles (identités de service au moindre privilège, points de terminaison privés, VPC-SC autour des API d'IA). L'examen de renouvellement mentionne en outre **Gemini in Security** — l'assistance par IA intégrée aux produits de sécurité de Google tels que Security Command Center. (Workload Identity Federation, auparavant absent, est désormais disponible : `enable_workload_identity_federation` dans Services_GCP crée le pool `wif-pool` avec un fournisseur GitHub Actions / GitLab CI / OIDC générique selon `wif_provider_type` — un lab de CI sans clé opérationnel.)

**⚠️ Piège d'examen** — IAP et Cloud Armor répondent à des questions différentes : IAP authentifie des *identités* (qui êtes-vous ?) ; Cloud Armor filtre du *trafic* (cette requête est-elle malveillante ?). « Seuls les employés peuvent accéder à l'application » → IAP ; « bloquer l'injection SQL et les attaques DDoS » → Cloud Armor. Les scénarios nécessitent souvent les deux, mais jamais l'un à la place de l'autre.

---

## 3.2 Concevoir pour la conformité (Designing for compliance) {#32-designing-for-compliance}

> ⏱ ~60 min · 💰 faible à modéré — les journaux d'audit d'accès aux données peuvent accroître les coûts de stockage des journaux · ⚙️ Prérequis : `enable_audit_logging = true` ; les étapes SCC nécessitent `enable_security_command_center = true` (des rôles au niveau de l'organisation sont requis pour les notifications)

**Pourquoi l'examen s'y intéresse** — Les questions de conformité évaluent la correspondance entre preuves et contrôles : quels journaux prouvent qui a fait quoi (Admin Activity ou Data Access), comment les résultats sont remontés et acheminés, et comment les contraintes régionales/réglementaires (HIPAA, PCI-DSS, résidence des données) façonnent l'architecture.

**Comment RAD le met en œuvre**

*Piste d'audit.* `enable_audit_logging` (par défaut `false`) configure les journaux d'audit `allServices` pour `ADMIN_READ`, `DATA_READ` et `DATA_WRITE` — les journaux Admin Activity (`ADMIN_WRITE`) sont toujours actifs et gratuits, mais les journaux Data Access doivent être activés explicitement, ce que fait précisément la plateforme, avec en plus des configurations explicites par service pour Secret Manager et Cloud KMS, de sorte que l'accès aux secrets et aux clés est journalisé de manière vérifiable.

*Résultats et posture.* `enable_security_command_center` (par défaut `false`) plus `enable_scc_notifications` acheminent les résultats vers un sujet Pub/Sub (`scc-{prefix}-findings`). La configuration des notifications est conditionnée par une sonde de permissions au niveau de l'organisation — si le compte de service qui déploie ne dispose pas des rôles SCC au niveau de l'organisation, la fonctionnalité est ignorée avec un avertissement au lieu de faire échouer l'application. Les clusters GKE activent en outre la gestion de la posture de sécurité (mode `BASIC`, mode de vulnérabilité `VULNERABILITY_BASIC`).

*Contrôles d'exfiltration et de résidence.* VPC-SC (3.1) est aussi la réponse de conformité aux exigences de frontière des données ; l'emplacement régional est contrôlé par `availability_regions`.

**À vous de jouer**

1. Activez `enable_audit_logging = true`, puis lisez ou écrivez une version de secret et retrouvez l'événement d'accès :

```bash
gcloud logging read \
  'logName:"cloudaudit.googleapis.com%2Fdata_access" AND protoPayload.serviceName="secretmanager.googleapis.com"' \
  --limit=5 --format="table(timestamp, protoPayload.methodName, protoPayload.authenticationInfo.principalEmail)"
```

2. Dans **Console > IAM & Admin > Audit Logs**, vérifiez que Data Read/Write sont activés pour « All services », avec des lignes par service pour Secret Manager et KMS.
3. Si SCC est actif, parcourez **Console > Security > Security Command Center > Findings** et vérifiez la présence du sujet `scc-{prefix}-findings` dans **Pub/Sub**.
4. Vous savez que cela a fonctionné lorsque la requête sur les journaux renvoie l'adresse e-mail du principal et la méthode de votre accès au secret — des preuves d'audit à la demande.

**Testez-vous**
<details>
<summary>Q1 : Un auditeur demande la preuve de chaque lecture des secrets de données patients au cours des 30 derniers jours. La journalisation par défaut du projet ne peut pas la fournir — pourquoi, et que change cette plateforme ?</summary>

R : Les lectures sont des événements Data Access (`DATA_READ`), que Google désactive par défaut pour des raisons de coût ; seuls les journaux Admin Activity sont toujours actifs. `enable_audit_logging = true` active `ADMIN_READ`/`DATA_READ`/`DATA_WRITE` pour tous les services, avec une couverture explicite de Secret Manager — ce qui rend la piste des lectures interrogeable dans Logs Explorer (et exportable vers BigQuery pour une conservation longue).
</details>

<details>
<summary>Q2 : Pourquoi la fonctionnalité de notification SCC est-elle « ignorée silencieusement avec un avertissement » au lieu d'échouer, et de quel principe de conception s'agit-il ?</summary>

R : Les configurations de notification SCC exigent des permissions au niveau de l'organisation que le compte de service qui déploie ne détient pas forcément dans chaque projet tenant. La sonde de permissions dégrade le comportement en douceur — une posture de sécurité partielle plutôt qu'un déploiement de plateforme en échec. Le principe : séparer la *disponibilité du mécanisme* de la *disponibilité des privilèges*, et ne jamais laisser un contrôle facultatif bloquer le chemin critique. Retenez pour l'examen que la gestion complète de SCC se fait au niveau de l'organisation.
</details>

**Au-delà des modules** — Non couverts : Assured Workloads (régions réglementées/contrôles du personnel), Access Transparency (journaux des accès par le personnel de *Google*), résidence des données fondée sur les règles d'administration (`gcp.resourceLocations`), DLP/Sensitive Data Protection pour la découverte et le masquage des données personnelles, et les correspondances formelles de conformité (BAA HIPAA, partage des responsabilités PCI-DSS). Étudiez le « Compliance resource center » et exécutez un modèle d'inspection DLP sur un bucket d'exemple dans un projet de test.

**⚠️ Piège d'examen** — Les journaux Admin Activity sont gratuits, toujours actifs et immuables ; les journaux Data Access sont à activer, volumineux et facturables (BigQuery et certains services font exception). Un scénario du type « qui a *modifié* le pare-feu » ne nécessite aucune configuration ; « qui a *lu* les données » nécessite que les journaux Data Access aient été activés *avant* l'incident — vous ne pouvez pas les activer rétroactivement.
