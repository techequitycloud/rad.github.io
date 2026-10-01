---
title: "Préparation PSE, section 4 : gestion des opérations"
description: "Préparez la section 4 de l'examen Professional Cloud Security Engineer (PSE) — gestion des opérations — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PSE_Section_4_Exploration_Guide.md @ cb682e8 -->

# Guide de préparation à la certification PSE : Section 4 — Gestion des opérations (Managing operations) (~19 % de l'examen) {#pse-certification-preparation-guide-section-4--managing-operations-19-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pse_section4.png" alt="Guide de préparation à la certification PSE : Section 4 — Gestion des opérations (~19 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [certification Professional Cloud Security Engineer](https://cloud.google.com/learn/certification/cloud-security-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Ce guide couvre la section 4 de l'examen Professional Cloud Security Engineer. Les modules fondamentaux concernés : `Services_GCP` (Binary Authorization, Artifact Registry, journalisation d'audit, SCC, surveillance), `App_CloudRun`/`App_GKE` (CI/CD avec attestation, journalisation d'audit, surveillance) et `App_Common` (signature des images). Avant de commencer, déployez le profil **secure-platform** avec `binauthz_evaluation_mode = "REQUIRE_ATTESTATION"` ainsi qu'un module d'application.

---

## 4.1 Automatisation de la sécurité de l'infrastructure et des applications (Automating infrastructure and application security) {#41-automating-infrastructure-and-application-security}

> ⏱ ~2.5 h · 💰 faible — minutes Cloud Build + analyses Container Analysis · ⚙️ Prérequis : secure-platform (`enable_binary_authorization`, `enable_vulnerability_scanning`) ; un module d'application avec `enable_cicd_trigger` pour le pipeline complet

**Pourquoi l'examen s'y intéresse** — La sécurité de la chaîne d'approvisionnement logicielle est très présente à l'examen : détection des vulnérabilités à chaque push, conditionnement des déploiements aux résultats d'analyse, attestations cryptographiques (qui signe, avec quelle clé, vérifiée par qui), modes d'évaluation et d'application de Binary Authorization pour GKE et Cloud Run, durcissement et application automatisés des correctifs aux images de VM et de conteneurs, et détection des écarts de stratégie et de configuration à grande échelle.

**Comment RAD le met en œuvre** — La chaîne complète lorsque `enable_binary_authorization = true` (`false` par défaut) avec `binauthz_evaluation_mode` (`ALWAYS_ALLOW` par défaut ; également `REQUIRE_ATTESTATION`, `ALWAYS_DENY`) :

1. **Clé de signature** — une clé KMS de signature asymétrique (RSA 2048, SHA-256). `Services_GCP` crée `binauthz-{prefix}-signer` dans le trousseau `binauthz-{prefix}-keyring` ; la couche applicative utilise le trousseau `{project}-binauthz-keyring` avec la clé `binauthz-signer`. Les deux chemins de création sont idempotents et restaurent/réactivent la version 1 si elle était programmée pour destruction.
2. **Attesteur** — une note Container Analysis (`binauthz-{prefix}-note`) encapsulée par l'attesteur `binauthz-{prefix}-pipeline-attestor`, qui porte la clé publique KMS.
3. **Stratégie** — importée via `gcloud container binauthz policy import` de manière *additive* : la stratégie actuelle est exportée, l'attesteur est ajouté à `requireAttestationsBy` seulement s'il est absent (pour que plusieurs tenants coexistent), avec le mode d'évaluation `REQUIRE_ATTESTATION`, le mode d'application « bloquer et consigner dans le journal d'audit », et des modèles de liste d'autorisation pour les images système Google (`gke.gcr.io/*`, `gcr.io/cloudrun/*`, `gcr.io/cloud-sql-connectors/*`, ...). La stratégie survit à la destruction par conception.
4. **Application au niveau des clusters/services** — les clusters GKE appliquent la stratégie Binary Authorization unique du projet lorsqu'elle est activée ; Cloud Run respecte la stratégie du projet.
5. **Signature dans le pipeline** — le déclencheur Cloud Build (`enable_cicd_trigger` + `cicd_trigger_config`, modèle de branche `^main$` par défaut) effectue le build avec Kaniko, puis exécute `gcloud beta container binauthz attestations sign-and-create` avec la clé KMS ; les images du premier déploiement sont signées par la couche applicative afin que l'application initiale ne se retrouve pas bloquée. L'IAM du SA Cloud Build est restreinte en conséquence : `roles/binaryauthorization.attestorsViewer`, `roles/cloudkms.signerVerifier`, `roles/containeranalysis.notes.attacher`.
6. **Analyse des vulnérabilités** — `enable_vulnerability_scanning` (`false` par défaut) active les API Container Analysis + On-Demand Scanning et active l'analyse à chaque push pour le dépôt Artifact Registry (activation héritée, sinon désactivée) ; le SA de build reçoit `roles/containeranalysis.occurrences.viewer` pour lire les résultats.

L'IaC en tant qu'automatisation de la sécurité se manifeste aussi par la correction des écarts : un redéploiement annule les modifications IAM effectuées hors processus, et les sondes exécutées au moment du plan (récupération des clés KMS, vérifications d'autorisations) rétablissent automatiquement la base de sécurité. Les clusters GKE activent en outre le tableau de bord de la posture de sécurité (posture de base + analyse de base des vulnérabilités) et s'exécutent sur le canal de publication `REGULAR`, avec des nœuds protégés (démarrage sécurisé + surveillance de l'intégrité) sur les pools de nœuds STANDARD.

**Essayez**
1. Dans **Console > Security > Binary Authorization**, passez en revue la stratégie : règle par défaut `REQUIRE_ATTESTATION`, votre attesteur listé, application « Block and audit log ».
```bash
gcloud container binauthz policy export
gcloud container binauthz attestors list
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/$GOOGLE_PROJECT_ID/shared-repo-<prefix> \
  --show-occurrences --occurrence-filter='kind="VULNERABILITY"' --limit=5
```
2. Test négatif — déployez une image publique non signée et observez l'échec de l'admission :
```bash
gcloud run deploy binauthz-test --image=docker.io/library/nginx:latest \
  --region=us-central1 --no-allow-unauthenticated
# Expect: "Container image ... must be attested by attestor projects/.../attestors/..."
```
3. Dans **Artifact Registry > repository > image > Vulnerabilities**, passez en revue les CVE détectées pour chaque digest après un push.
4. Vous savez que cela a fonctionné lorsque le déploiement non signé est rejeté pour violation de Binary Authorization, tandis que l'image construite et attestée par le pipeline se déploie sans erreur.

**Testez-vous**
<details>
<summary>Q1 : Scénario — un développeur contourne la CI et exécute `gcloud run deploy` avec une image construite sur son ordinateur portable. Avec le profil secure-platform, que se passe-t-il, et pourquoi ?</summary>

R : Le déploiement est rejeté. La stratégie Binary Authorization exige une attestation de l'attesteur du pipeline ; seul Cloud Build (qui détient `roles/cloudkms.signerVerifier` sur la clé de signature) crée des attestations, et uniquement après avoir construit l'image. Une image issue d'un ordinateur portable n'a pas d'attestation ; `ENFORCED_BLOCK_AND_AUDIT_LOG` la bloque donc et écrit une entrée dans le journal d'audit.
</details>

<details>
<summary>Q2 : Quelle est la différence entre `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION` et `ALWAYS_DENY`, et quand utiliseriez-vous chacun ?</summary>

R : `ALWAYS_ALLOW` admet tout (phase de déploiement initial/d'amorçage — c'est la valeur par défaut du module, pour que les premiers déploiements réussissent) ; `REQUIRE_ATTESTATION` n'admet que les images portant une signature valide des attesteurs requis (production en régime établi) ; `ALWAYS_DENY` bloque tous les nouveaux déploiements (gel d'urgence pendant un incident). L'application par opposition à la simulation (dry-run) est un axe distinct : la simulation consigne les violations potentielles sans bloquer.
</details>

<details>
<summary>Q3 : Pourquoi le module importe-t-il la stratégie Binary Authorization de manière additive au lieu de la déclarer comme une simple ressource Terraform ?</summary>

R : La stratégie est un **singleton** au niveau du projet. Une simple ressource détenue par l'état d'un seul tenant écraserait, à chaque application, les exigences d'attesteur de tous les autres tenants. Le cycle exporter-fusionner-importer n'ajoute l'attesteur de ce déploiement que s'il est absent, ce qui rend sûrs plusieurs déploiements indépendants — et la stratégie survit volontairement à la destruction pour que les autres tenants conservent leur protection.
</details>

**Au-delà des modules** — Non mis en œuvre : l'échec du build selon la gravité des CVE (les résultats d'analyse existent ; une étape de contrôle qui interroge Container Analysis et s'interrompt sur les résultats CRITICAL vous est laissée — essayez `gcloud artifacts docker images scan IMAGE --format="value(response.scan)"` puis `gcloud artifacts docker images list-vulnerabilities SCAN_ID`), la validation continue (revalidation après déploiement des pods en cours d'exécution), la création et le durcissement automatisés d'images de VM (images de référence, familles d'images) et la gestion des correctifs de l'OS pour des parcs de VM (`gcloud compute os-config patch-jobs execute`), les alertes de surveillance de l'intégrité de Shielded VM, la stratégie en tant que code avec Policy Controller/OPA (la fonctionnalité de parc `configure_policy_controller` existe dans `Services_GCP`, proposée uniquement dans un projet que vous apportez, mais la rédaction de contraintes est hors périmètre), et la détection des écarts de posture et de configuration à grande échelle — la posture de sécurité de Security Command Center (gestion de la posture de sécurité du cloud), les contraintes personnalisées des règles d'administration, et les modules personnalisés de Security Health Analytics.

**⚠️ Piège d'examen** — L'analyse des vulnérabilités *informe*, Binary Authorization *applique* — l'analyse seule ne bloque jamais un déploiement. À l'inverse, Binary Authorization vérifie des signatures, pas des CVE : une image attestée mais vulnérable se déploie, à moins que votre pipeline refuse de l'attester. L'examen attend que vous enchaîniez analyse → attestation conditionnelle → application.

---

## 4.2 Configuration de la journalisation, de la surveillance et de la détection (Configuring logging, monitoring, and detection) {#42-configuring-logging-monitoring-and-detection}

> ⏱ ~2 h · 💰 modéré si la journalisation DATA_READ reste activée (volume de journaux) · ⚙️ Prérequis : secure-platform (`enable_audit_logging`, `enable_security_command_center`, `enable_scc_notifications`)

**Pourquoi l'examen s'y intéresse** — Vous devez connaître les quatre types de Cloud Audit Logs (Admin Activity, toujours activé et gratuit ; Data Access, à activer explicitement sauf pour BigQuery ; System Event ; Policy Denied), la manière d'activer les journaux Data Access par service, la façon dont les résultats SCC sont produits et acheminés, et la conception de l'accès aux journaux, de leur conservation et de leur exportation.

**Comment RAD le met en œuvre** —
- **Configuration des journaux d'audit** — `enable_audit_logging` (`false` par défaut, disponible à l'identique dans `Services_GCP`, `App_CloudRun` et `App_GKE`) : une configuration d'audit IAM pour tous les services qui active `ADMIN_READ`, `DATA_READ` et `DATA_WRITE` (ADMIN_WRITE est toujours activé), plus des configurations explicites par service pour `secretmanager.googleapis.com` et `cloudkms.googleapis.com` (DATA_READ + DATA_WRITE), afin que les lectures de secrets et l'utilisation des clés laissent toujours une trace.
- **Inscription à SCC** — `enable_security_command_center` (`false` par défaut) active l'API `securitycenter.googleapis.com` et crée le sujet Pub/Sub `scc-{prefix}-findings`. `enable_scc_notifications` (`false` par défaut) provisionne l'identité de service des notifications SCC, lui accorde `roles/pubsub.publisher` sur le sujet, puis — uniquement si une sonde d'autorisation au niveau de l'organisation (`gcloud scc notifications list --organization=...`) réussit — crée une configuration de notification SCC filtrée sur les résultats `state="ACTIVE"` de ce projet. Faute de `roles/securitycenter.notificationConfigEditor` au niveau de l'organisation, la configuration est ignorée avec un avertissement au lieu de faire échouer l'application. Les deux paramètres SCC ne sont proposés que lorsque vous déployez dans un projet qui vous appartient ; un projet géré par RAD les retire du formulaire, car la configuration de notification est une ressource de niveau organisation.
- **Surveillance et alertes** — `Services_GCP` crée des règles d'alerte d'infrastructure pilotées par `alert_cpu_threshold` / `alert_memory_threshold` / `alert_disk_threshold` (tous `80` par défaut), avec des canaux e-mail issus de `configure_email_notification` + `notification_alert_emails` ; les modules d'application créent des canaux à partir de `support_users`, des `alert_policies` personnalisées (type de métrique, comparaison, seuil, durée) limitées au service, un tableau de bord et — pour les points de terminaison accessibles publiquement — une vérification synthétique de disponibilité plus une alerte d'échec issues de `uptime_check_config`. Les clusters GKE incluent la journalisation du cluster pour les composants système et les charges de travail, ainsi que Prometheus géré (managed Prometheus).
- **Journalisation en périphérie/des requêtes** — le service de backend placé derrière Cloud Armor journalise chaque requête au taux d'échantillonnage maximal, ce qui vous fournit les journaux des verdicts du WAF pour le travail de détection.

**Essayez**
1. Activez les indicateurs d'audit/SCC et redéployez. Dans **Console > IAM & Admin > Audit Logs**, vérifiez que « All services » affiche Admin Read / Data Read / Data Write activés, avec Secret Manager et KMS configurés individuellement.
2. Générez puis retrouvez un événement d'accès aux données :
```bash
gcloud secrets versions access latest --secret=secret-<instance>-<service> >/dev/null
gcloud logging read \
  'logName:"cloudaudit.googleapis.com%2Fdata_access" AND protoPayload.serviceName="secretmanager.googleapis.com"' \
  --limit=5 --format="table(timestamp, protoPayload.authenticationInfo.principalEmail, protoPayload.methodName)"
```
3. Reliez les résultats à un consommateur et observez-les circuler :
```bash
gcloud pubsub subscriptions create scc-tap --topic=scc-<prefix>-findings
gcloud pubsub subscriptions pull scc-tap --auto-ack --limit=5
```
   Dans **Security > Security Command Center > Findings**, filtrez sur votre projet et comparez avec ce qui arrive sur l'abonnement (seuls les résultats ACTIVE passent le filtre).
4. Vous savez que cela a fonctionné lorsque votre propre appel `AccessSecretVersion` apparaît dans les journaux Data Access et qu'un résultat SCC (par ex. issu de Security Health Analytics) arrive dans le pull Pub/Sub.

**Testez-vous**
<details>
<summary>Q1 : Scénario — le SOC demande la preuve de chaque lecture de secret au cours des 30 derniers jours. Projet par défaut, rien d'activé. Pouvez-vous la fournir, et qu'est-ce que la plateforme change ?</summary>

R : Non — `AccessSecretVersion` est un événement DATA_READ, et les journaux d'audit Data Access sont désactivés par défaut (sauf pour BigQuery). Les preuves n'existent qu'à partir du moment où ils sont activés. Le paramètre `enable_audit_logging` de la plateforme les active à l'échelle du projet, en plus de configurations explicites pour Secret Manager/KMS ; la leçon pour l'examen est d'activer les journaux Data Access des services sensibles *avant* l'incident.
</details>

<details>
<summary>Q2 : Pourquoi le module achemine-t-il les résultats SCC vers Pub/Sub au lieu de s'appuyer sur le tableau de bord SCC ?</summary>

R : Pub/Sub rend les résultats exploitables par des machines en quasi-temps réel — ingestion dans un SIEM, création de tickets, remédiation automatisée — et découple les producteurs des consommateurs. Un tableau de bord exige qu'un humain le consulte. Notez l'exigence au niveau de l'organisation : les configurations de notification sont des ressources de l'organisation, d'où la sonde d'autorisation et l'abandon en douceur.
</details>

<details>
<summary>Q3 : Une application réussit, mais aucune configuration de notification SCC n'existe et le journal affiche un avertissement sur l'autorisation au niveau de l'organisation. S'agit-il d'un bug ?</summary>

R : Non — c'est le mode dégradé documenté. La création d'une configuration de notification SCC exige `roles/securitycenter.notificationConfigEditor` au niveau de l'organisation ; le module effectue d'abord une sonde et ignore l'étape avec un avertissement, afin qu'un compte de service limité au projet puisse tout de même déployer tout le reste. Accordez le rôle au niveau de l'organisation et redéployez pour obtenir la configuration.
</details>

**Au-delà des modules** — Non mis en œuvre : les journaux réseau — journaux de flux VPC (`gcloud compute networks subnets update SUBNET --enable-flow-logs --logging-flow-sampling=1.0`), la journalisation des règles de pare-feu Cloud NGFW, les récepteurs de journaux/récepteurs agrégés vers BigQuery/GCS/Pub-Sub (`gcloud logging sinks create`), Bucket Lock/la conservation verrouillée pour la conformité WORM, Log Analytics, Cloud IDS, Packet Mirroring, les spécificités d'Event Threat Detection / Container Threat Detection (SCC Premium), Security Command Center Enterprise et Google SecOps (SIEM/SOAR) pour l'exportation des journaux vers des systèmes de sécurité externes et pour la réponse aux incidents et leur remédiation à l'aide de dossiers (cases) et de playbooks. Pistes de conception : vues de journaux + `roles/logging.viewAccessor` pour un accès des analystes au moindre privilège ; conservation de 400 jours via des récepteurs pour les journaux Admin Activity.

**⚠️ Piège d'examen** — Les journaux d'audit Admin Activity sont toujours activés, gratuits et ne peuvent pas être désactivés ; les journaux Data Access sont à activer explicitement, facturés au volume de journaux, et peuvent coûter cher à grande échelle (en particulier DATA_READ sur `storage.googleapis.com`). « Tout activer partout » est un piège de coût ; « se fier aux valeurs par défaut pour l'investigation » est un piège de preuve. Délimitez délibérément la journalisation Data Access — comme l'illustrent les remplacements explicites du module pour Secret Manager/KMS.
