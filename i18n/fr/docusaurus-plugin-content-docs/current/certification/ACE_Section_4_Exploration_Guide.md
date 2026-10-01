---
title: "Préparation ACE, section 4 : configuration des accès et de la sécurité"
description: "Préparez la section 4 de l'examen Associate Cloud Engineer (ACE) — configuration des accès et de la sécurité — avec des labs RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/ACE_Section_4_Exploration_Guide.md @ cb682e8 sha256:159c362eb324 -->

# Guide de préparation à la certification ACE : Section 4 — Configuration des accès et de la sécurité (Configuring access and security) (~20 % de l'examen) {#ace-certification-preparation-guide-section-4--configuring-access-and-security-20-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/ace_section4.png" alt="Guide de préparation à la certification ACE : Section 4 — Configuration des accès et de la sécurité (~20 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [certification Associate Cloud Engineer](https://cloud.google.com/learn/certification/cloud-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Ce guide couvre la Section 4 de l'examen à l'aide des modules de base de la plateforme RAD. La sécurité est le domaine où les modules brillent en tant que lab : chaque déploiement crée des comptes de service dédiés (`Services_GCP` plus la couche IAM de la plateforme), `App_GKE` utilise Workload Identity, `Services_GCP` peut mettre en place Workload Identity Federation, et les secrets résident exclusivement dans Secret Manager. Déployez le profil **application serverless** ainsi que le profil **compléments d'exploitation et de sécurité** (IAP, journalisation d'audit) de la [cartographie des labs](ACE_Certification_Guide.md).

Lors de l'examen de **renouvellement** ACE, seul l'objectif 4.2 (Gestion des comptes de service) de cette section est évalué ; le 4.1 ne l'est pas.

---

## 4.1 Gestion de l'IAM (Managing IAM) {#41-managing-iam}

> ⏱ ~60 min · 💰 aucun coût supplémentaire (la journalisation d'audit augmente le volume de journaux) · ⚙️ Prérequis : n'importe quel profil déployé ; `enable_audit_logging = true` pour le lab sur les journaux d'audit

**Pourquoi l'examen s'y intéresse** — Les questions sur l'IAM portent sur la consultation et la création de stratégies IAM, le modèle de stratégie (compte principal + rôle + ressource), l'attribution de rôles au niveau de l'organisation, du dossier et du projet ainsi que leur héritage vers le bas de la hiérarchie de l'organisation, les trois types de rôles (de base, prédéfinis, personnalisés) et le moment où chacun est approprié, ainsi que la lecture et le dépannage des accès effectifs. Le critère de décision récurrent : préférez des rôles prédéfinis attribués à des groupes ; n'accordez jamais `roles/owner`/`roles/editor` en production ; les rôles de base sont un héritage antérieur à l'IAM.

**Comment RAD le met en œuvre** — Les modules sont un exemple concret du principe du moindre privilège :
- `Services_GCP` crée `cloudbuild-sa-{prefix}`, `clouddeploy-sa-{prefix}`, `cloudrun-sa-{prefix}`, `nfs-sa-{prefix}` et `gke-sa-{prefix}`, chacun recevant des rôles prédéfinis adaptés à sa tâche — avec un rôle de base à repérer : `cloudbuild-sa-{prefix}` détient `roles/viewer` au niveau du projet.
- La couche IAM de la plateforme ajoute des liaisons *au niveau des ressources* : le compte de service d'exécution reçoit `roles/secretmanager.secretAccessor` *par secret* et `roles/storage.objectAdmin` *par bucket*, et Cloud Build reçoit `roles/iam.serviceAccountUser` sur l'identité de charge de travail sous laquelle il déploie. Notez toutefois que `Services_GCP` accorde aussi aux comptes de service d'exécution partagés (`cloudrun-sa-*`, `gke-sa-*`) `secretAccessor` et `storage.objectAdmin` au niveau du *projet*, et `serviceAccountUser` à Cloud Build sur tout le projet — l'accès effectif est donc l'union des deux, et ce ne sont pas les autorisations au niveau des ressources qui le limitent. Savoir lire l'accès effectif à ces deux niveaux est précisément la compétence évaluée par cet objectif.
- `enable_audit_logging` (par défaut `false`, disponible sur `Services_GCP` et sur les deux modules applicatifs) — les journaux d'audit relèvent désormais de l'objectif 3.4 dans le guide d'examen actuel, mais ce sont eux qui permettent de répondre à « qui a modifié cette stratégie IAM ? », c'est pourquoi ils restent dans ce lab — active les journaux d'audit Data Access (`ADMIN_READ`/`DATA_READ`/`DATA_WRITE`) pour `allServices`, ainsi que des configurations explicites pour Secret Manager et KMS — le mécanisme qui permet de savoir « qui a fait quoi ».
- `support_users` (par défaut `[]`) est le point d'entrée des comptes principaux humains : les adresses e-mail deviennent des destinataires des notifications de surveillance ; dans la mesure du possible, liez vos opérateurs sous forme de groupes.

**Essayez**
1. Extrayez et lisez la stratégie IAM du projet comme l'attend l'examen :
   ```bash
   gcloud projects get-iam-policy $GOOGLE_CLOUD_PROJECT \
     --flatten="bindings[].members" \
     --filter="bindings.members:serviceAccount" \
     --format="table(bindings.members, bindings.role)" | sort
   ```
   Vérifiez que les comptes de service du module détiennent des rôles prédéfinis, et trouvez l'unique rôle de base (`roles/viewer` sur `cloudbuild-sa-*`).
2. Observez une liaison *au niveau d'une ressource* (un concept que beaucoup de candidats négligent) :
   ```bash
   gcloud secrets get-iam-policy <secret-name>
   gcloud storage buckets get-iam-policy gs://<bucket-name>
   ```
   Le compte de service d'exécution apparaît ici *et* (d'après l'étape 1) dans la stratégie du projet, avec les mêmes rôles — l'accès effectif est l'union des deux, si bien que l'autorisation plus étroite au niveau de la ressource ne restreint rien tant que celle au niveau du projet existe.
3. Explorez les définitions de rôles : `gcloud iam roles describe roles/secretmanager.secretAccessor` — notez qu'il ne contient pratiquement qu'une seule autorisation (`secretmanager.versions.access`). Comparez avec `gcloud iam roles describe roles/editor` pour comprendre pourquoi les rôles de base sont déconseillés.
4. Avec la journalisation d'audit activée, modifiez une liaison IAM quelconque dans la console, puis retrouvez-la :
   ```bash
   gcloud logging read 'protoPayload.methodName="SetIamPolicy"' --limit=5 \
     --format="table(timestamp, protoPayload.authenticationInfo.principalEmail)"
   ```
5. Vous savez que cela a fonctionné lorsque les étapes 2 à 4 montrent des liaisons par ressource, un rôle prédéfini comportant presque une seule autorisation, et votre propre adresse e-mail dans l'entrée `SetIamPolicy`.

**Testez-vous**
<details>
<summary>Q1 : Un développeur doit consulter les services Cloud Run et lire leurs journaux — rien d'autre. Quels rôles, et pourquoi pas <code>roles/viewer</code> ?</summary>

R : `roles/run.viewer` plus `roles/logging.viewer` — des rôles prédéfinis limités exactement aux services nécessaires. `roles/viewer` (un rôle de base) accorde un accès en lecture à presque *tous* les services du projet, ce qui enfreint le principe du moindre privilège et expose des données (par ex. la liste des secrets, les métadonnées des buckets) que le développeur n'a aucune raison de voir.
</details>

<details>
<summary>Q2 : Un compte de service dispose de <code>roles/secretmanager.secretAccessor</code> uniquement sur le secret <code>app-db-password</code>, mais la mise en situation de l'examen indique qu'il « ne peut pas lister les secrets dans la console ». Y a-t-il un problème ?</summary>

R : Non — `secretAccessor` permet de *lire les versions* de ce secret précis, pas de lister les secrets (ce qui nécessite `secretmanager.secrets.list`, présent dans des rôles comme `roles/secretmanager.viewer` au niveau du projet). Les autorisations au niveau d'une ressource ne confèrent pas de droit de consultation au niveau du projet ; cette asymétrie est voulue et fréquemment évaluée.
</details>

<details>
<summary>Q3 : Un accès accordé au niveau d'un dossier — un administrateur au niveau d'un projet enfant peut-il le retirer ?</summary>

R : Non. Les stratégies IAM sont héritées vers le bas et la stratégie *effective* est l'union de tous les niveaux ; une ressource enfant ne peut ni révoquer ni restreindre une autorisation accordée sur l'un de ses ancêtres. Il faudrait modifier la liaison au niveau du dossier (ou utiliser des stratégies de refus IAM / des conditions, gérées au-dessus du projet).
</details>

**Au-delà des modules** — Non implémentés : la création de rôles personnalisés, l'attribution de rôles au niveau de l'organisation ou d'un dossier, les conditions IAM, l'outil de dépannage des stratégies (Policy Troubleshooter) et l'administration des règles au niveau de l'organisation. Pour l'examen : créez un rôle personnalisé jetable (`gcloud iam roles create labRole --project=$GOOGLE_CLOUD_PROJECT --permissions=run.services.list`), accordez un rôle sur un dossier de test (`gcloud resource-manager folders add-iam-policy-binding`) et vérifiez qu'il apparaît comme hérité sur un projet enfant dans **IAM**, exécutez **IAM & Admin > Policy Troubleshooter** sur un triplet compte principal/ressource/autorisation, et examinez les recommandations de rôles IAM dans **IAM** (Active Assist signale les liaisons trop permissives en se fondant sur l'utilisation des 90 derniers jours).

**⚠️ Piège d'examen** — Retirer un utilisateur de l'IAM n'invalide pas les jetons d'accès déjà émis (jusqu'à ~1 heure) et ne touche pas aux liaisons au niveau des ressources que vous avez pu oublier — vérifier *à la fois* les stratégies du projet et celles des ressources est la réponse complète.

---

## 4.2 Gestion des comptes de service (Managing service accounts) {#42-managing-service-accounts}

> ⏱ ~75 min · 💰 aucun coût supplémentaire · ⚙️ Prérequis : profil application serverless ou application Kubernetes ; `enable_iap = true` avec des utilisateurs autorisés pour le lab IAP

**Pourquoi l'examen s'y intéresse** — Les comptes de service sont au cœur de l'identité des charges de travail : créer des comptes de service dédiés au lieu d'utiliser ceux par défaut, les associer aux ressources de calcul, éviter les clés JSON exportées (au profit de Workload Identity, de Workload Identity Federation ou de l'emprunt d'identité), et protéger les identifiants des applications. Le guide actuel mentionne aussi les comptes de service gérés par Google, la gestion des autorisations IAM *sur* un compte de service (qui peut l'utiliser ou emprunter son identité), la création d'identifiants de courte durée et le provisionnement de Workload Identity Federation. Le fil conducteur constant de l'examen : *les clés sont un dernier recours*.

**Comment RAD le met en œuvre** —

*Identités d'exécution dédiées :* le service Cloud Run s'exécute sous son `cloudrun-sa-*` propre au tenant, jamais sous le compte de service Compute Engine par défaut. Sur GKE, `App_GKE` met en œuvre Workload Identity de bout en bout : un ServiceAccount Kubernetes annoté `iam.gke.io/gcp-service-account`, et une liaison `roles/iam.workloadIdentityUser` vers `serviceAccount:{project}.svc.id.goog[namespace/ksa]` — les pods obtiennent des identifiants Google de courte durée, sans aucun fichier de clé nulle part.

*CI/CD sans clé :* `enable_workload_identity_federation` de `Services_GCP` (par défaut `false`) crée le pool `wif-pool` avec un fournisseur selon `wif_provider_type` (par défaut `"github"` ; également `gitlab` ou OIDC `generic`) et lie les comptes principaux du pool (`roles/iam.workloadIdentityUser`) aux comptes de service Cloud Build, Cloud Deploy et Cloud Run — la CI externe s'authentifie en échangeant son jeton OIDC, sans aucune clé exportée.

*Comptes de service gérés par Google :* avec `enable_cmek = true`, `Services_GCP` s'assure que les agents de service de Cloud SQL, AlloyDB et Artifact Registry existent (`google_project_service_identity`) et recherche l'agent de service de Cloud Storage, puis accorde à chacun `roles/cloudkms.cryptoKeyEncrypterDecrypter` sur sa clé — les agents de service sont des identités créées par Google auxquelles vous accordez des rôles, mais que vous ne créez jamais vous-même et pour lesquelles vous ne générez jamais de clé.

*Autorisations IAM sur un compte de service :* le compte de service est aussi une ressource. `App_Common` accorde à Cloud Build `roles/iam.serviceAccountUser` *sur le compte de service de la charge de travail lui-même* (une liaison dans la stratégie IAM propre au compte de service), et `Services_GCP` permet de la même manière à Cloud Build d'agir en tant que compte de service Cloud Deploy — observez-les avec `gcloud iam service-accounts get-iam-policy <sa-email>`.

*Emprunt d'identité :* la plateforme elle-même s'exécute en tant que `resource_creator_identity`, et `impersonation_service_account` (par défaut `""`) fait appeler les API GCP par les scripts shell des modules sous l'identité d'un compte de service cible — le même schéma `--impersonate-service-account` que l'examen évalue pour les utilisateurs humains.

*Secrets :* `secret_environment_variables` associe des noms de variables d'environnement à des secrets Secret Manager résolus à l'exécution (une source de variable d'environnement par référence de secret sur Cloud Run ; le pilote CSI Secret Manager sur GKE). Le mot de passe de la base de données est généré aléatoirement (`database_password_length` par défaut `32`), stocké uniquement dans Secret Manager, et `enable_auto_password_rotation` (par défaut `false`) déploie un job de rotation déclenché par Eventarc, qui effectue une rotation à deux versions sans interruption de service (`rotation_propagation_delay_sec` par défaut `90`). Le simple `secret_rotation_period` (par défaut `"2592000s"`) ne fait que publier des *notifications* de rotation — il n'effectue lui-même aucune rotation.

*Accès conditionné par l'identité :* Secret Manager et IAP ne sont pas cités dans le guide d'examen actuel ; ils restent dans ce lab comme exemples concrets d'autorisations minimales impliquant des comptes de service. `enable_iap` (par défaut `false`) active IAP. Sur Cloud Run, le service v2 active IAP (stade de lancement BETA) et le module accorde `roles/run.invoker` à l'agent de service IAP et `roles/iap.httpsResourceAccessor` à `iap_authorized_users`/`iap_authorized_groups`. Sur GKE, IAP exige en outre `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email` et au moins un compte principal autorisé — le tout imposé par des validations au moment du plan.

**Essayez**
1. Vérifiez que la charge de travail s'exécute sous un compte de service dédié et non sous celui par défaut :
   ```bash
   gcloud run services describe <service-name> --region=us-central1 \
     --format="value(spec.template.spec.serviceAccountName)"
   ```
2. Sur GKE, vérifiez Workload Identity depuis l'intérieur d'un pod :
   ```bash
   kubectl get serviceaccount -n <namespace> -o yaml | grep gcp-service-account
   kubectl run wi-test -n <namespace> --rm -it --image=google/cloud-sdk:slim \
     --overrides='{"spec":{"serviceAccountName":"<ksa-name>"}}' \
     -- gcloud auth list
   ```
   Le compte actif est le compte de service Google — aucune clé n'a été montée.
3. Entraînez-vous à l'emprunt d'identité (accordez-vous d'abord `roles/iam.serviceAccountTokenCreator` sur le compte de service) :
   ```bash
   gcloud storage ls --impersonate-service-account=cloudrun-sa-<prefix>@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com
   ```
4. Inspectez la gestion des secrets : `gcloud secrets versions list <secret-name>` et, après avoir activé `enable_auto_password_rotation`, observez l'apparition d'une nouvelle version pendant que la précédente est désactivée (rotation à deux versions).
5. Activez IAP avec `iap_authorized_users = ["user:you@example.com"]`, redéployez, puis ouvrez l'URL du service dans une fenêtre de navigation privée — vous êtes redirigé vers la connexion Google, et un compte non listé reçoit une erreur 403. Vous savez que cela a fonctionné lorsque votre compte passe et que les autres sont refusés.

**Testez-vous**
<details>
<summary>Q1 : Un pod GKE doit lire un bucket GCS. Un collègue suggère de monter une clé JSON de compte de service sous forme de Secret Kubernetes. Quelle est l'alternative correcte selon l'examen, et pourquoi ?</summary>

R : Workload Identity — liez le KSA du pod à un compte de service Google disposant de `roles/storage.objectViewer` (le schéma `roles/iam.workloadIdentityUser` utilisé par `App_GKE`). Les clés JSON n'expirent jamais, peuvent être exfiltrées par quiconque peut lire les secrets du namespace et nécessitent une rotation manuelle ; Workload Identity émet automatiquement des jetons de courte durée, avec une attribution complète dans les journaux d'audit.
</details>

<details>
<summary>Q2 : GitHub Actions doit déployer sur Cloud Run. Options : télécharger une clé pour le compte de service Cloud Build, ou utiliser Workload Identity Federation. Comparez.</summary>

R : WIF (le `wif-pool` du module + un fournisseur OIDC GitHub) permet au workflow d'échanger son jeton OIDC émis par GitHub contre des identifiants GCP de courte durée — rien n'est stocké dans les secrets du dépôt, la portée est limitée automatiquement et tout est auditable. Une clé téléchargée est un identifiant porteur de longue durée stocké dans les secrets GitHub ; en cas de fuite, elle fonctionne jusqu'à sa destruction manuelle. La réponse attendue à l'examen est WIF (ou l'emprunt d'identité) plutôt que des clés, pratiquement toujours.
</details>

<details>
<summary>Q3 : Avec IAP activé sur Cloud Run, un utilisateur s'authentifie avec succès avec son compte Google mais reçoit tout de même une erreur 403. Quelles sont les deux autorisations qui doivent exister ensemble ?</summary>

R : L'*utilisateur* a besoin de `roles/iap.httpsResourceAccessor` (via `iap_authorized_users`/`iap_authorized_groups`), et l'*agent de service IAP* a besoin de `roles/run.invoker` sur le service, afin de pouvoir transmettre les requêtes authentifiées. Une authentification (qui vous êtes) réussie alors que l'autorisation (ce à quoi vous pouvez accéder) échoue correspond exactement à cette séparation — le module crée les deux liaisons pour vous.
</details>

**Au-delà des modules** — Non implémentés : les flux de création et de rotation de clés de compte de service (délibérément — les modules évitent entièrement les clés), l'émission de jetons de courte durée (`gcloud auth print-access-token --impersonate-service-account=...`, `gcloud auth print-identity-token`), la désactivation/restauration de comptes de service, et l'utilisation de comptes de service entre projets. Entraînez-vous dans un projet de test : `gcloud iam service-accounts create`, `gcloud iam service-accounts keys create` (puis supprimez la clé et expliquez pourquoi), et `gcloud iam service-accounts add-iam-policy-binding <sa> --member=user:you@... --role=roles/iam.serviceAccountTokenCreator` pour mettre en place l'emprunt d'identité. Révisez aussi le compte de service Compute Engine par défaut (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) et pourquoi l'associer avec un accès de niveau Editor est l'anti-modèle par excellence.

**⚠️ Piège d'examen** — `roles/iam.serviceAccountUser` (associer le compte de service ou s'exécuter *en tant que* celui-ci) et `roles/iam.serviceAccountTokenCreator` (émettre des jetons pour *emprunter son identité*) sont des rôles différents ; les questions reposent souvent sur celui dont un déployeur ou un emprunteur d'identité a réellement besoin. Les modules accordent `serviceAccountUser` à Cloud Build précisément pour qu'il puisse déployer des services qui s'exécutent sous le compte de service d'exécution.
