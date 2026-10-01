---
title: "Préparation PSE, section 5 : exigences de conformité"
description: "Préparez la section 5 de l'examen Professional Cloud Security Engineer (PSE) — prise en charge des exigences de conformité — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PSE_Section_5_Exploration_Guide.md @ cb682e8 sha256:84de1f6e449a -->

# Guide de préparation à la certification PSE : Section 5 — Prise en charge des exigences de conformité (Supporting compliance requirements) (~11 % de l'examen) {#pse-certification-preparation-guide-section-5--supporting-compliance-requirements-11-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pse_section5.png" alt="Guide de préparation à la certification PSE : Section 5 — Prise en charge des exigences de conformité (~11 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [certification Professional Cloud Security Engineer](https://cloud.google.com/learn/certification/cloud-security-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Ce guide couvre la section 5 de l'examen Professional Cloud Security Engineer. Aucun module ne porte à lui seul la conformité ; ce sont les quatre modules fondamentaux qui apportent ensemble les contrôles techniques demandés par les auditeurs — CMEK, configuration d'audit immuable par défaut, IAM au moindre privilège, périmètres, et réduction du périmètre de responsabilité grâce aux plateformes gérées (GKE Autopilot, Cloud Run). Avant de commencer, déployez le profil **secure-platform** (idéalement avec **perimeter-lab**), car la plupart des exercices de collecte de preuves ci-dessous dépendent de ses indicateurs.

---

## 5.1 Respect des exigences réglementaires et des normes sectorielles pour le cloud (Adhering to regulatory and industry standards requirements for the cloud) {#51-adhering-to-regulatory-and-industry-standards-requirements-for-the-cloud}

> ⏱ ~2 h · 💰 aucun coût supplémentaire au-delà des profils sous-jacents · ⚙️ Prérequis : secure-platform ; SCC activé pour les résultats de posture

**Pourquoi l'examen s'y intéresse** — L'examen teste trois compétences : (1) raisonner avec le modèle de responsabilité partagée / de destin partagé (shared fate) selon les niveaux de service (IaaS → GKE Standard → Autopilot → Cloud Run), (2) associer une exigence réglementaire (PCI-DSS, HIPAA, RGPD) au contrôle Google Cloud précis qui la satisfait, (3) délimiter le périmètre — savoir que la conformité s'applique aux projets/services qui manipulent des données réglementées, et non à toute l'organisation — et (4) déterminer les besoins techniques qu'un régime impose au calcul, aux données, au réseau et au stockage, puis configurer les contrôles qui y répondent (Assured Workloads, règles d'administration, Access Transparency, Access Approval, régionalisation des données et des services, segmentation du réseau et des accès, couverture des journaux d'audit).

**Comment RAD le met en œuvre** — Les modules forment une *bibliothèque de contrôles* de conformité que vous pouvez montrer à un auditeur :

| Exigence de conformité (typique) | Contrôle déployé | Où |
|---|---|---|
| Chiffrement au repos avec des clés contrôlées par le client | `enable_cmek` — clés par service, rotation tous les 90 jours (`cmek_key_rotation_period`, `7776000s` par défaut) | le trousseau CMEK et les clés par service |
| Chiffrement en transit | TLS au niveau de l'équilibreur de charge global (certificats gérés), redirection HTTP→HTTPS, mode SSL chiffré uniquement pour Cloud SQL | la périphérie de l'équilibreur de charge et l'instance Cloud SQL |
| Preuve des accès / piste d'audit | `enable_audit_logging` — ADMIN_READ/DATA_READ/DATA_WRITE pour tous les services + remplacements pour Secret Manager/KMS | la configuration d'audit IAM du projet |
| Moindre privilège | IAM par secret/par bucket, SA dédiés, Workload Identity | la couche IAM au niveau des ressources et les comptes de service |
| Rotation des identifiants | `enable_auto_password_rotation` + `secret_rotation_period` (`2592000s` par défaut) | le pipeline de rotation Secret Manager |
| Prévention de l'exfiltration de données | périmètre `enable_vpc_sc` avec niveaux d'accès, déploiement progressif en simulation (dry-run) | le périmètre VPC Service Controls |
| Chaîne d'approvisionnement logicielle de confiance | `enable_binary_authorization` (`REQUIRE_ATTESTATION`) + `enable_vulnerability_scanning` | la stratégie Binary Authorization et le dépôt Artifact Registry |
| Détection continue des erreurs de configuration | `enable_security_command_center` + résultats vers Pub/Sub | l'inscription à SCC et le sujet des résultats |
| Prévention de l'exposition publique | prévention de l'accès public appliquée + accès uniforme au niveau du bucket sur le bucket de sauvegarde | le bucket de sauvegarde |
| Sauvegarde/conservation | PITR Cloud SQL (7 jours de journaux de transactions, 7 sauvegardes quotidiennes), cycle de vie du bucket selon `backup_retention_days` | l'instance Cloud SQL et le bucket de sauvegarde |
| Résidence des données (ancrage régional) | toutes les ressources placées dans les `availability_regions` sélectionnées ; dans un projet géré par RAD, la règle d'administration `gcp.resourceLocations` du dossier de palier limite en outre les régions qui peuvent être choisies | le VPC et les paramètres de région de chaque ressource |

La responsabilité partagée est observable, et pas seulement théorique : les clusters GKE Autopilot (`gke_cluster_mode`, `AUTOPILOT` par défaut) confient à Google le durcissement de l'OS des nœuds, l'application des correctifs (réparation et mise à niveau automatiques sur le canal de publication `REGULAR`) et la configuration des nœuds, tandis que le mode STANDARD montre la ligne qui revient de votre côté — le module doit alors gérer lui-même le pool de nœuds, avec des paramètres de nœuds protégés (démarrage sécurisé et surveillance de l'intégrité) rendus explicites sur les nœuds. Cloud Run réduit encore votre périmètre : aucun nœud, seulement le code, l'IAM et la posture réseau.

**Essayez**
1. Constituez un dossier de preuves pour un audit fictif — chaque commande ci-dessous produit un élément que vous pourriez remettre à un évaluateur :
```bash
# Encryption: which CMEK key protects the database?
gcloud sql instances describe <instance> \
  --format="value(diskEncryptionConfiguration.kmsKeyName)"
# Audit posture: which log types are enabled project-wide?
gcloud projects get-iam-policy $GOOGLE_PROJECT_ID --format="yaml(auditConfigs)"
# Least privilege: who can read the DB password?
gcloud secrets get-iam-policy secret-<instance>-<service>
# Supply chain: what does the admission policy require?
gcloud container binauthz policy export
# Residency: where does everything actually live?
gcloud sql instances describe <instance> --format="value(region)"
gcloud storage buckets list --format="table(name, location)"
```
2. Dans **Console > Security > Security Command Center > Findings** (nécessite SCC, que la plateforme n'active que dans un projet que vous apportez), filtrez sur votre projet et traitez chaque résultat ACTIVE comme une exception d'audit : identifiez le contrôle enfreint et la variable du portail qui y remédie.
3. Dans **Kubernetes Engine > Clusters**, ouvrez le panneau de posture **Security** d'un cluster Autopilot et listez les contrôles indiqués comme gérés par Google — cette liste *constitue* votre preuve de réduction de la responsabilité.
4. Vous savez que cela a fonctionné lorsque vous pouvez présenter, pour une exigence de référentiel de votre choix, la variable, la ressource et la preuve vérifiable en CLI, en une ligne chacune.

**Testez-vous**
<details>
<summary>Q1 : Scénario — un évaluateur HIPAA demande qui est responsable de l'application des correctifs de l'OS des nœuds Kubernetes qui exécutent des charges de travail traitant des données de santé protégées (PHI). Votre réponse dépend d'une seule variable du portail — laquelle, et comment ?</summary>

R : `gke_cluster_mode`. En `AUTOPILOT` (la valeur par défaut), Google gère le provisionnement des nœuds, le durcissement de l'OS et l'application des correctifs — cela relève du côté Google de la ligne de responsabilité partagée (couvert par le BAA). En `STANDARD`, la gestion des nœuds est configurée par vous (le module définit la mise à niveau/réparation automatique et les paramètres de nœuds protégés, mais la responsabilité — et le périmètre d'audit — vous incombent).
</details>

<details>
<summary>Q2 : Associez l'article 17 du RGPD (droit à l'effacement), appliqué aux sauvegardes, à un contrôle déployé.</summary>

R : L'effacement cryptographique (crypto-shredding) via CMEK : les données Cloud SQL *et leurs sauvegardes* sont chiffrées avec `cloudsql-{prefix}-key`. Détruire les versions de cette clé rend l'ensemble — y compris les sauvegardes que vous ne pouvez pas modifier individuellement — définitivement illisible. Associez-le à la suppression par cycle de vie `backup_retention_days` du bucket de sauvegarde, pour la minimisation des données.
</details>

<details>
<summary>Q3 : Scénario — seul le service de paiement traite des données de titulaires de cartes, mais le RSSI veut que les contrôles PCI (application de VPC-SC, CMEK, journalisation Data Access) soient appliqués aux 40 projets de l'organisation. Que conseillez-vous ?</summary>

R : Réduire le périmètre. PCI-DSS s'applique à l'environnement des données de titulaires de cartes (CDE) ; appliquer le maximum de contrôles partout multiplie les coûts (volume des journaux Data Access) et les frictions opérationnelles (dysfonctionnements liés à VPC-SC) sans réduire le risque pour le CDE. Isolez les charges de travail concernées dans des projets/dossiers dédiés, appliquez-y le profil strict (le modèle de périmètre par projet de cette plateforme s'y prête naturellement), et documentez la segmentation comme limite du périmètre.
</details>

**Au-delà des modules** — Non mis en œuvre, à étudier séparément :
- **Assured Workloads** — dossiers associés à un régime de conformité (FedRAMP, EU Sovereign Controls) qui appliquent d'emblée des contraintes d'emplacement et de personnel : `gcloud assured workloads list --organization=ORG_ID --location=us-central1` (**Console > Compliance > Assured Workloads**).
- **Access Transparency et Access Approval** — journaux des actions du *personnel de Google* sur votre contenu, et validation préalable avant un tel accès ; filtrez Logs Explorer sur `cloudaudit.googleapis.com%2Faccess_transparency`. Transparency = enregistrement passif, Approval = contrôle actif ; Access Approval nécessite Access Transparency, et les deux dépendent d'un abonnement d'assistance ou d'organisation éligible (vérifiez l'éligibilité en vigueur).
- **Rapports de posture de conformité SCC** — mise en correspondance des résultats avec CIS GCP Foundations, PCI-DSS, NIST 800-53, ISO 27001 dans SCC Premium (**SCC > Compliance**).
- **Règles d'administration pour la conformité** — par ex. `constraints/gcp.resourceLocations` pour la régionalisation et `constraints/gcp.restrictServiceUsage` pour tenir les services hors périmètre à l'écart d'un dossier réglementé ; définissez-les sur le dossier qui contient les projets concernés, afin que chaque projet en hérite.
- **Documentation de conformité** — le portail des rapports de conformité de Google (SOC 2, certificats ISO), le processus BAA HIPAA et la liste des services éligibles, ainsi que les conditions relatives à la résidence et au traitement des données. L'examen attend que vous sachiez que vous héritez des certifications de Google pour l'infrastructure, mais que vous devez toujours faire certifier votre propre configuration et vos propres processus.

**⚠️ Piège d'examen** — « Google Cloud est conforme PCI-DSS / HIPAA, donc mon application l'est » est toujours faux. La conformité n'est héritée que pour les couches qu'exploite Google ; votre configuration IAM, réseau, de chiffrement et de journalisation — précisément les variables qu'expose cette plateforme — reste de votre responsabilité, et un bucket mal configuré fait échouer l'audit quels que soient les certificats que détient Google.
