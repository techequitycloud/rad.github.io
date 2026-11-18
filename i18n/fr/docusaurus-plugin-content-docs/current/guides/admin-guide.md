---
title: "Guide de l'administrateur"
description: "Guide de l'administrateur de la plateforme RAD — gestion des utilisateurs et des rôles, paramètres de la plateforme, catalogue de modules, demandes de configuration et tickets de support, et supervision des revenus, des coûts et de l'audit."
---

<!-- translated-from: docs/guides/admin-guide.md @ 2be24ed1 sha256:ec493f4608ea -->

# Guide de l'administrateur {#administrator-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Admin_Guide.png" alt="Guide de l'administrateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Pour les administrateurs qui gèrent la plateforme RAD : gestion des utilisateurs, des rôles, des crédits, des modules, des demandes et supervision. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

En tant qu'administrateur, vous disposez d'un accès superutilisateur. En plus de tout ce qu'un utilisateur standard peut faire (construire une solution à partir d'une description, parcourir le catalogue de modules sur **Solutions → Solution Catalog → RAD modules**, configurer et déployer, gérer vos propres **Deployments**, utiliser des **Credits**, ainsi que l'onglet **Calculate ROI** de la page **Credits**), vous pouvez :

- Consulter, rechercher, créer, modifier, activer/désactiver et supprimer des utilisateurs (**Users**).
- Modifier les indicateurs de rôle de n'importe quel utilisateur (User, Partner, Agent, Finance, Support, Trainer, Admin), ainsi que les soldes de crédits de tout autre utilisateur.
- Attribuer des crédits en masse et envoyer des messages aux utilisateurs.
- Configurer le comportement à l'échelle de la plateforme sur la page **Setup**, y compris l'activation ou la désactivation de **Credits**.
- Synchroniser les **modules de plateforme** dans le catalogue à partir de leur dépôt GitHub.
- Traiter les demandes de configuration (**Setup Requests**) et les tickets de support (**Support Tickets**) (onglets sur la page **Help**).
- Visualiser l'ensemble des revenus, des coûts, des factures et des règlements sur toute la plateforme.
- Consulter le journal d'audit (**Audit Log**) : chaque action enregistrée sur la plateforme, son auteur et son horodatage.

Une fois connecté, vous arrivez sur la page **Users**. Votre navigation supérieure affiche : Deployments, Solutions, Setup, Users, Audit Log, Sync, Pricing et Help, ainsi que **Credits** (en premier) si votre compte détient également le rôle User, Partner ou Agent (et que les crédits sont activés). Le catalogue de modules correspond à **RAD modules** dans l'onglet **Solution Catalog** de Solutions ; il ne possède plus sa propre entrée de menu. Setup Requests et Support Tickets sont des onglets situés dans la page **Help** plutôt que des éléments du menu principal.

## Gérer les utilisateurs {#managing-users}

Accédez à la page **Users** pour gérer l'ensemble des personnes sur la plateforme.

**Consulter et rechercher.** Vous voyez une liste paginée et interrogeable de tous les utilisateurs enregistrés. Lancez une recherche pour trouver un utilisateur par son adresse e-mail — le filtre reste en place après l'enregistrement d'une modification, de sorte que l'utilisateur modifié reste visible à l'écran — puis lisez sa ligne : les badges de rôle à côté de l'adresse, une colonne pour son statut actif, une pour chaque rôle (Admin, User, Partner, Agent, Finance, Support, Trainer ; Finance uniquement lorsque **Enable Subscription** est activé), et **Deploys paused**. Les soldes de crédits ne sont pas affichés ici.

**Créer un utilisateur.** Activez **Private Mode** dans **Setup** et deux boutons apparaissent au-dessus de la liste des utilisateurs. **Add New User** crée directement un compte pour que cette personne puisse se connecter. **Restore User** réadmet une personne que vous aviez précédemment supprimée en lui créant un nouveau compte avec un solde nul. L'historique de la suppression est conservé, elle ne reçoit donc pas de nouveaux crédits d'inscription. Aucun de ces boutons n'apparaît, et aucune de ces actions n'est acceptée, tant que la plateforme est en mode public, car les personnes peuvent s'inscrire elles-mêmes.

**Modifier les rôles.** Sélectionnez **Edit** sur la ligne d'un utilisateur, puis définissez :

- Le statut **Active** — voir Activer ou désactiver ci-dessous.
- **Deploys paused** — refuse les nouveaux déploiements, les mises à jour et les purges pour ce compte jusqu'à ce que vous le désactiviez ; les destructions restent autorisées. Utilisez-le pour un compte dont les builds échouent constamment ou qui fait un usage abusif de la plateforme. Les administrateurs et Finance peuvent le définir, jamais sur leur propre compte, et chaque modification est consignée dans le journal d'audit.
- **Indicateurs de rôle** — Admin, User, Partner, Agent, Support et Trainer sont toujours visibles. **Finance** n'apparaît qu'une fois **Enable Subscription** activé dans **Setup**. La case **Agent** ne peut être cochée que si les utilisateurs peuvent payer (voir [Attribuer des rôles](#assigning-roles)).

Sélectionnez **Save** pour appliquer vos modifications.

**La modification des crédits s'effectue ailleurs.** Les soldes par utilisateur se trouvent sur l'onglet **Credit Management** de la page **Billing**, qui permet de modifier séparément Awards, Subscription, Top-up et l'allocation mensuelle partenaire (Monthly Partner allotment). Personne — administrateurs compris — ne peut modifier son propre solde ; demandez à un autre administrateur ou utilisateur finance, afin que l'opération porte deux identités distinctes. Pour la même raison, les comptes administrateur et finance ne peuvent pas réclamer de **codes d'événement** (event codes), et personne ne peut réclamer un code qu'il a lui-même créé.

**Activer ou désactiver.** Basculez le statut actif d'un utilisateur pour lui accorder ou lui retirer l'accès. La désactivation réinitialise tous les rôles non administrateurs détenus par le compte (User, Partner, Agent, Finance, Support, Trainer) ainsi que son allocation mensuelle partenaire ; la réactivation ne rétablit que **User**, il vous faudra donc réattribuer tout autre rôle manuellement. Des mesures de sécurité s'appliquent : vous ne pouvez pas désactiver un compte qui détient le rôle Admin.

**Supprimer un utilisateur.** Supprimer un utilisateur supprime définitivement ses modules publiés, puis son compte. Cette opération est refusée — pour vous comme pour lui — tant que l'un de ses déploiements est encore actif (détruisez-les d'abord), ou tant que le compte a une dette envers RAD ou est responsable de ressources financées par RAD : frais d'utilisation ou de build impayés, solde acheté inférieur à zéro, projet client qu'il gère non clôturé et non réglé, projet associé dont RAD assure encore le paiement ou le détachement, ou session de lab en cours non réglée. Le message de refus énumère les motifs. Elle est également refusée pendant environ une journée après la suppression de l'un de ses projets gérés par RAD, le temps que Google communique les coûts définitifs de ce projet. Si le compte dispose d'un abonnement payant, sa suppression résilie l'abonnement auprès du prestataire de paiement et ses crédits d'abonnement non dépensés sont perdus. Ses enregistrements de déploiement sont conservés (marqués comme appartenant à un compte supprimé) afin que l'utilisation tardive de Google Cloud soit facturée au bon payeur. Un enregistrement minimal de la suppression est conservé pour que cette même adresse e-mail ne puisse plus jamais obtenir de crédits d'inscription si elle s'inscrit à nouveau, et l'historique des transactions de crédits est préservé pour les audits.

**Mesures de sécurité à connaître.**

- Vous ne pouvez pas désactiver un administrateur.
- Vous ne pouvez pas retirer le dernier administrateur de la plateforme, ni supprimer le compte du dernier administrateur.
- Le rôle d'administrateur d'un administrateur initial (bootstrap) ne peut pas être révoqué et son compte ne peut pas être supprimé. Retirez d'abord son adresse e-mail de la liste d'autorisation des administrateurs bootstrap, puis réessayez.
- Personne ne peut modifier son propre solde de crédits, y compris les administrateurs.
- Il n'existe aucun moyen de se connecter sous l'identité d'un autre utilisateur ou de procéder à un emprunt d'identité. La supervision par les administrateurs s'effectue via les pages Users, Deployments et les rapports, et non en agissant à la place de quelqu'un d'autre.

## Attribuer des rôles {#assigning-roles}

RAD comprend sept rôles : **User, Admin, Partner, Agent, Finance, Support, Trainer**. Une même personne peut en détenir plusieurs simultanément (par exemple Agent + Partner), et son menu combine l'ensemble des accès accordés. Un Partner ou un Trainer est toujours également un User. Les rôles sont attribués par un administrateur via la page **Users** et enregistrés sur la fiche de compte de l'utilisateur (l'administrateur initial est verrouillé via une liste d'autorisation bootstrap).

Définissez les rôles d'un utilisateur en modifiant sa ligne sur la page **Users** et en cochant les indicateurs correspondants. Ce que chaque rôle débloque :

- **User** — rôle par défaut. Déployer des modules et gérer ses propres déploiements et crédits.
- **Admin** — administration complète de la plateforme (le présent guide).
- **Partner** — publier des modules à partir de son propre dépôt et percevoir les revenus partenaires. L'attribution du rôle Partner est manuelle ; la souscription à une formule de crédits ne l'accorde pas.
- **Agent** — rôle commercial : perçoit une commission en argent sur les frais de module que ses utilisateurs parrainés paient avec des crédits achetés, suivie sur **Credits → My Commission** (voir le [Guide de l'agent](agent-guide.md)). Il ne peut être accordé que tant que les utilisateurs peuvent **acheter des crédits ou s'abonner**, ce qui implique que les crédits soient activés et que Stripe ou Flutterwave le soit également. Lorsque les paiements sont désactivés, la case reste verrouillée et une note en explique la raison. Un agent existant peut toujours être décoché, et conserve son rôle si les paiements sont désactivés ultérieurement. La **désactivation** du compte d'un agent interrompt sa commission : plus aucun montant n'est enregistré, et les sommes déjà comptabilisées sont bloquées jusqu'à la réactivation du compte.
- **Finance** — rapports financiers et règlements ; utilise la page **Billing**.
- **Support** — traitement et tri des tickets de support (**Support Tickets**, un onglet de la page Help). Un agent de support ne voit les déploiements que pour les clients dont les tickets ouverts lui sont affectés, et n'a jamais accès aux variables ni aux sorties d'un déploiement. La résolution ou la fermeture du ticket met fin à cet accès.
- **Trainer** — anime des **sessions de lab** depuis **Solutions → Managed Environments** : inscrit une cohorte de participants, finance leurs places ou leur fait acheter leur propre place, et déploie un environnement de lab par participant. Ce rôle constitue l'intégralité du droit d'accès — il n'y a pas de liste d'inscription à remplir — le décocher supprime donc immédiatement l'accès. La désactivation d'un compte le réinitialise également, et une réactivation ne le restaure pas. Un formateur est toujours traité comme un utilisateur standard, il conserve donc les pages utilisateur, notamment **Credits**, qui permet de financer ses sessions. Contrairement au support, un formateur peut mettre à jour et détruire les environnements de lab qu'il a provisionnés, afin qu'une session ne laisse aucune infrastructure derrière elle. Un formateur peut voir les sorties d'un environnement de lab (les valeurs sensibles étant masquées) mais jamais ses variables de configuration ni les identifiants générés, ne voit jamais les déploiements personnels des participants, et ne peut pas déployer au nom d'un tiers depuis le formulaire de déploiement standard.

Consultez le [Guide du formateur](trainer-guide.md) pour découvrir la vue correspondante du côté formateur.

### Intégrer un partenaire {#onboarding-a-partner}

Faire de quelqu'un un partenaire nécessite trois étapes, dont la dernière vous incombe :

1. Cochez **Partner** sur sa ligne dans la page **Users**.
2. Le partenaire connecte son dépôt GitHub depuis son **Profile** (en installant la GitHub App RAD Module Sync, puis en sélectionnant le dépôt). Cela permet à RAD de **lire** ses modules, de sorte qu'il puisse les synchroniser et les voir répertoriés — voir le [Guide du partenaire](partner-guide.md).
3. **Activer le déploiement de ses modules.** Le build d'un déploiement clone le dépôt du partenaire à l'aide d'un identifiant spécifique que seul un administrateur peut créer. Dans le service **Secret Manager** du projet de la plateforme RAD, créez un secret nommé `partner-github-token-<partner's user ID>` — l'ID correspond à l'identifiant utilisateur Firebase Authentication du partenaire, soit la même valeur que celle stockée sous `partnerId` sur ses modules — avec réplication automatique, contenant un jeton GitHub disposant des droits de lecture sur ce dépôt. Tant qu'il n'existe pas, tout déploiement des modules du partenaire (par le partenaire ou par un client) est refusé avec l'erreur *"Deployment repository credentials are not configured or accessible"*. Effectuez donc cette opération avant que le partenaire ne rende un module public.

Révoquer le rôle Partner, ou désactiver le compte, interrompt son allocation mensuelle partenaire. Supprimez également le secret si les modules du partenaire ne doivent plus pouvoir être déployés.

**Fonctionnement des sessions de lab.** Activez d'abord **Enable Lab Sessions** dans **Setup** ; tant que cette option est désactivée, les sessions de lab sont masquées de **Solutions → Managed Environments**, l'entrée de menu **Labs** pour le rôle Finance est masquée, et toute route d'API liée aux labs renvoie une erreur *not found*. Les mêmes variables de Setup définissent les plafonds imposés au formateur : nombre maximal de participants, durée et crédits par participant, ainsi que la simultanéité des approvisionnements.

Un formateur crée une session sur **Solutions → Managed Environments** (**Lab sessions → New lab session**) et choisit le mode de paiement :
- **Les participants achètent leur propre place.** Il s'agit du choix par défaut pour une nouvelle session. Chaque participant paie à partir de ses propres crédits achetés avant que toute ressource ne soit créée pour lui. Si l'un d'eux ne peut pas payer sur RAD (banque non acceptée par le prestataire de paiement, ou espèces), le formateur peut payer cette place spécifique avec ses propres crédits achetés via **Pay for place** ; la ligne indique alors **Paid by trainer**. Seul le formateur de la session se voit proposer cette option, car elle consomme ses crédits.
- **Le formateur paie.** La totalité de l'allocation est réservée à l'avance sur les crédits achetés du formateur.

Chaque participant reçoit **un environnement** sur le palier **lab**, qui dispose de son propre dossier, de ses propres règles d'organisation et de son propre budget — ou, dans une session partagée (**Shared**), le formateur crée un environnement unique pour l'ensemble du groupe que tous les participants utilisent. Le palier lab n'est jamais proposé comme choix manuel sur aucun formulaire de déploiement classique. Les crédits non utilisés sont reversés au formateur une fois que Google a communiqué les coûts réels de la session.

Vous pouvez visualiser et gérer les sessions de tous les formateurs, et vous êtes le seul à pouvoir forcer une destruction. Finance peut consulter chaque session et y mettre fin, mais ne peut pas la modifier. Vous seul pouvez déployer au nom d'un tiers depuis le formulaire de déploiement standard, et uniquement au sein d'un projet géré par RAD : le déploiement de chaque participant va dans son propre projet et est payé par ce participant. Le seuil minimal de crédits achetés s'applique au participant, pas à vous ; vous pouvez donc sélectionner un participant disposant de fonds même si vous n'avez aucun crédit acheté. Il n'existe aucune exemption d'administrateur concernant ce plancher : déployer dans un projet géré par RAD pour vous-même nécessite les mêmes crédits achetés que pour n'importe qui d'autre, faute de quoi RAD désactiverait ce projet en quelques minutes.

## Attributions de crédits en masse et envoi de messages {#bulk-credit-awards-and-messaging-users}

Deux actions groupées sont à votre disposition, et aucune ne se trouve sur la page Users :

- **Attribuer des crédits en masse** — onglet **Credit Settings** sur la page **Billing**. L'ajustement s'applique à *tous* les utilisateurs simultanément ; vous ne pouvez pas en sélectionner un sous-ensemble. Saisissez un montant positif à ajouter ou négatif à déduire, et choisissez s'il est versé sous forme de crédits offerts gratuits ou de crédits achetés. Les montants de 10 000 ou plus exigent une justification et une confirmation saisie au clavier, et les crédits doivent être activés sur toute la plateforme. Pour modifier le solde d'une seule personne, utilisez plutôt **Credit Management** sur la même page.
- **Envoyer un message aux utilisateurs** — onglet **Send Message** sur la page **Help**, qui affiche un formulaire de message au lieu du formulaire de support visible par les autres utilisateurs. Envoyez à tous les utilisateurs, ou recherchez et sélectionnez jusqu'à 100 destinataires (la recherche fonctionne sur n'importe quelle partie de l'adresse e-mail, un domaine permet donc de cibler toutes les personnes associées) ; les messages sont limités à 5 000 caractères.

Il s'agit du moyen le plus rapide d'organiser des promotions, de recharger les soldes après un incident de service ou de diffuser une annonce à l'échelle de la plateforme.

## Paramètres de la plateforme (Setup) {#platform-settings-setup}

La page **Setup** vous permet de configurer le comportement global de la plateforme. Ajustez les paramètres ici chaque fois que vous devez modifier le fonctionnement de la plateforme, puis enregistrez.

Les commandes essentielles à votre disposition incluent l'activation ou la désactivation des crédits sur l'ensemble de la plateforme via **Enable Credits**. Lorsque les crédits sont désactivés, la page Credits et les coûts en crédits sont masqués pour les utilisateurs ; lorsqu'ils sont activés, les déploiements sont décomptés en crédits comme décrit dans [Utiliser RAD](using-rad.md).

**Enable Subscription** constitue, malgré son nom, l'interrupteur général pour tout achat. S'il est désactivé, personne ne peut souscrire un nouvel abonnement **ni** effectuer une recharge ponctuelle : les deux prestataires de paiement sont désactivés, les routes de paiement refusent les requêtes, les liens *Buy credits* et *Subscribe* disparaissent de l'application, et les pages publiques **Pricing** ainsi que celles de connexion ne listent plus les formules. Les paiements déjà effectués sont toujours crédités, et les abonnés existants ne sont pas interrompus : leur formule continue de se renouveler jusqu'à résiliation, ce qu'ils peuvent toujours faire depuis la page **Credits**.

**Enforce Update Safe** détermine le comportement lorsqu'un utilisateur modifie un paramètre qui ne peut pas être changé sur un déploiement en cours d'exécution — une région, une clé de chiffrement, une option qui crée ou détruit une ressource. Les modules déclarent les paramètres pouvant être modifiés sans risque sur place ; tout le reste est considéré comme destructif.

- **Désactivé (par défaut)** — le champ reste modifiable et son changement affiche une demande de confirmation détaillant précisément les paramètres qui entraîneront une reconstruction des ressources. L'utilisateur décide.
- **Activé** — ces champs passent en lecture seule lors de la mise à jour d'un déploiement existant, ce qui implique que pour en modifier un, il faut supprimer et redéployer. Les administrateurs et partenaires en sont exemptés.

Activez cette option lorsqu'une reconstruction accidentelle s'avère coûteuse — environnements partagés, déploiements en production pour des clients, cohortes de formation. Laissez-la désactivée si les utilisateurs doivent pouvoir ajuster librement leurs propres déploiements.

**Enable Client Projects** (désactivé par défaut) permet aux abonnés de financer, déployer et exploiter des déploiements gérés par RAD pour leurs propres clients à partir d'un portefeuille dédié et isolé ; tant qu'elle est désactivée, cette fonctionnalité est masquée. **Client Project Pause Period (days)** définit la durée pendant laquelle un projet client reste en pause, avec sa facturation coupée et ses données conservées, après épuisement de son portefeuille et avant sa suppression définitive (7 jours par défaut, de 1 à 30). Consultez le [Guide des projets clients](client-projects-guide.md).

## Gérer les modules {#managing-modules}

Vous êtes responsable du catalogue des **modules de plateforme** que chaque utilisateur voit dans **Solutions → Solution Catalog → RAD modules**.

**Synchroniser les modules de plateforme.** Rendez-vous sur la page **Sync** pour intégrer les modules de plateforme dans le catalogue. Cette page est une console de synchronisation en lecture seule : elle liste les modules détectés dans le dépôt de la plateforme, et l'action **Sync Now** actualise le catalogue à partir de ce dépôt. Les modules eux-mêmes sont gérés dans le dépôt, et non édités sur cette page.

**Mettre à jour un module.** Modifiez le module dans le dépôt. Un push modifiant le fichier `variables.tf` d'un module se synchronise automatiquement, et une vérification horaire prend en charge tout push que RAD aurait manqué ; lancez **Sync Now** depuis la page Sync pour actualiser immédiatement sa définition (description, champs de configuration et coût en crédits) dans le catalogue.

**Supprimer un module.** La gestion des modules est en lecture seule par défaut : le paramètre **Module Console Read-Only** sur la page **Setup** est activé d'origine, ce qui masque l'action de suppression sur les fiches de module ainsi que sur leur page dédiée, et conduit la plateforme à rejeter toute suppression depuis la console. Pour supprimer un module, supprimez-le de son dépôt GitHub et laissez la synchronisation suivante le retirer du catalogue. Ce n'est que si vous désactivez ce paramètre qu'une action de suppression apparaît — vous permettant alors de supprimer n'importe quel module, qu'il appartienne à la plateforme ou qu'il ait été publié par un partenaire. Lorsqu'il est désactivé, l'entrée de menu **Sync** s'intitule **Publish**.

## Demandes de configuration (Setup Requests) {#setup-requests}

L'onglet **Setup Requests** de la page **Help** permet de gérer les demandes de configuration assistée. Examinez les demandes entrantes, assignez un ingénieur (qui doit posséder un compte partenaire existant), suivez leur état et supervisez-les jusqu'à leur achèvement. Lorsqu'une demande est finalisée, son revenu est réparti à 75 % pour l'ingénieur et 25 % pour la plateforme, à moins que le paramètre de plateforme `platformRevenueSharePct` (enregistré dans l'audit sous le nom *Platform revenue share (setup requests)* ; il ne dispose pas encore de champ de formulaire) ne définisse une autre valeur comprise entre 0 et 100. Finance a également accès à cet onglet ; en tant qu'administrateur, vous disposez d'une visibilité complète sur l'ensemble des demandes. Les utilisateurs dotés du rôle Support ne voient pas les demandes de configuration — ces dernières comportant des chiffres de revenus et de reversements aux partenaires.

## Tickets de support {#support-tickets}

L'onglet **Support Tickets** de la page **Help** répertorie les tickets créés via le formulaire de contact **Help**. Prenez en charge chaque ticket : mettez à jour son statut (new, in progress, resolved, closed), ajoutez des notes et assignez-le. Les utilisateurs dotés du rôle Support traitent également cette file d'attente ; en tant qu'administrateur, vous voyez tous les tickets. Le client suit son ticket sur son propre onglet **My Tickets**, qui indique le statut que vous avez défini, mais jamais vos notes internes ni l'identité de la personne assignée.

Un ticket créé à partir du bouton **Ask for help** d'un déploiement en échec arrive déjà qualifié : il intègre le déploiement concerné, son statut, le palier du projet ainsi que le diagnostic affiché au client avant l'envoi. Il est classé en **Technical** à moins que le client n'ait sélectionné une autre catégorie, et sa priorité passe automatiquement au minimum à **High** lorsque le déploiement se situe dans un projet de niveau production. L'ouverture d'un ticket nécessite des crédits achetés tant que la vente de crédits est ouverte, mais le personnel — administrateurs, partenaires, finance, support, agents et formateurs — en est toujours dispensé ; cette règle est appliquée directement par la plateforme, pas uniquement par le formulaire.

### Performances des agents (vue Agents) {#agent-performance-the-agents-view}

En tant qu'administrateur, vous disposez également d'un sélecteur **Tickets | Agents** en haut de l'onglet. La vue **Agents** utilise les mêmes filtres de dates **From**/**To** et affiche une ligne par agent pour la période sélectionnée :

- **Assigned**, **Resolved**, **Closed**, **Released / reassigned** et **Reopened** (un ticket résolu par l'agent qui a été rouvert) comptabilisent les événements survenus sur la période. **Withdrawn** comptabilise les tickets que le client a retirés alors que l'agent en avait la charge — présentés séparément, jamais comptés comme des résolutions. **Open now** indique les tickets actuellement ouverts de l'agent.
- **Time to resolve** mesure le temps écoulé entre le début de l'assignation de l'agent et le moment où il a résolu ou fermé le ticket (temps calendaire) : médiane, avec le 90e percentile et la moyenne affichés en dessous. Une réassignation réinitialise le décompte pour le nouveau titulaire.
- **Within SLA** indique la proportion de ces résolutions ayant respecté l'objectif associé à la priorité du ticket, avec un code couleur : vert (90 % ou plus), orange (70 % ou plus) ou rouge. Cliquez sur une ligne pour voir la répartition par priorité ainsi que les tickets traités ventilés par priorité et catégorie.
- La carte récapitulative au-dessus du tableau indique le délai moyen de première assignation pour l'équipe (**time to first assignment**, délai entre la soumission et la prise en charge par le premier agent).

RAD enregistre chaque assignation et chaque changement de statut sur un ticket à compter de cette version. Les tickets finalisés avant cela ne disposent pas d'historique d'assignation : ils sont comptabilisés dans les totaux mais exclus des calculs de durée, et le rapport indique le nombre de tickets **not recorded**. Le bouton **Export CSV** permet de télécharger ces lignes, avec des durées exprimées en nombres simples d'heures. Les utilisateurs des rôles Support et Finance n'ont pas accès à la vue Agents.

Les objectifs de SLA sont des paramètres configurables sur la page **Setup** (avec les autres paramètres de support) : **Support SLA: Urgent**, **High**, **Medium** et **Low**, exprimés en heures — par défaut 4, 24, 72 et 120, chacun devant être un nombre entier compris entre 1 et 2160.

## Visibilité sur les revenus, les coûts, les factures et les règlements {#visibility-into-revenue-costs-invoices-and-payouts}

Vous bénéficiez d'une visibilité financière globale sur la plateforme :

- **Revenus** — **Module Revenue** (frais de module et partages de revenus partenaires) et **Agent Revenue** (relevé des commissions d'agents, où une commission peut être annulée avec un motif, et lots de règlements d'agents créés avec une date limite et marqués comme payés avec une référence de paiement ; les agents sont rémunérés en dehors de RAD).
- **Coûts et factures** — **Project Transactions** et **Project Invoices** (coût cloud réel par projet et par mois) ; tous deux nécessitent l'activation de **Enable Project Credits**. Les coûts de module par déploiement figurent sur l'onglet **Module Costs** de la page **Credits** (affiché lorsque **Enable Subscription** est activé).
- **Règlements** — **Payout Summary**, totaux par bénéficiaire pour les agents et partenaires. L'action **Mark paid** y enregistre le règlement d'un partenaire pour une période échue, une seule fois, au taux en vigueur ; les agents sont quant à eux réglés via Agent Revenue.

Hormis Module Costs, ces rapports sont des onglets de la page **Billing**. Deux éléments à garder en tête avant de les chercher : votre menu de navigation administrateur ne comporte pas d'entrée Billing, vous devez donc soit vous attribuer également le rôle Finance (ce qui l'ajoute au menu), soit accéder directement à `/billing` ; de plus, chaque onglet de Billing à l'exception d'**Event Codes** requiert l'activation de **Enable Subscription** dans **Setup**. Si ce paramètre est désactivé, la page s'ouvre sur Event Codes et ne propose rien d'autre. Quatre onglets de Billing sont strictement réservés à Finance et ne sont pas visibles par les administrateurs : **Linked Projects** (approbation des demandes des clients souhaitant que RAD prenne en charge leurs propres projets Google Cloud), **Customer Billing** (taux de TVA de chaque client, informations fiscales et sous-compte de facturation), **VAT Report** — voir le [Guide finance](finance-guide.md#linked-projects-customer-billing-and-vat) — et **Missing Payments** (paiements prélevés par les prestataires mais non crédités, et procédure sécurisée pour les régulariser). Utilisez ces outils pour surveiller l'état de la plateforme, rapprocher les gains des partenaires et agents, et auditer les dépenses des projets.

## Déploiements en échec ou bloqués {#failed-and-stuck-deployments}

La plupart des incidents de déploiement sont désormais résolus sans nécessiter de ticket, et vous pouvez constater l'efficacité de ce mécanisme :

- **Les causes connues d'échec sont expliquées** directement sur l'étape concernée et dans l'e-mail de notification d'échec. Une vérification au sein du pipeline interrompt également tout déploiement ou mise à jour vers un projet existant avant qu'aucune modification ne soit apportée si le projet est inactif, si la facturation est coupée ou si l'identité de déploiement de RAD ne dispose pas des droits requis, tout en indiquant comment y remédier. Les pannes signalées par Google comme temporaires font automatiquement l'objet d'une nouvelle tentative.
- **Des suggestions de correction** (IA) couvrent les échecs non reconnus par RAD, destinées aux clients disposant de crédits achetés ainsi qu'au personnel, et aux clients sans crédits achetés lors de leurs premiers builds en échec (trois par défaut). Elles sont générées en arrière-plan peu après une défaillance, par petits lots, et peuvent proposer un ajustement de paramètre que le client applique via le formulaire standard de mise à jour. Seuls des paramètres simples et sans danger pour la mise à jour peuvent être suggérés (tailles, quantités, délais d'expiration, valeur issue de la liste propre au paramètre), à l'exclusion formelle des images, adresses, commandes, plages réseau, secrets, régions, ou paramètres relatifs au projet, à la facturation ou aux accès — le journal d'un build pouvant contenir du texte rédigé par la personne qui contrôle l'application, la liste des suggestions permises est volontairement très restreinte. L'application d'une suggestion crée une entrée d'audit `DEPLOYMENT_FAILURE_ADVICE_APPLIED` mentionnant les noms des paramètres, jamais leurs valeurs.
- **L'utilisation de l'IA est plafonnée par compte et n'est jamais facturée.** Toutes les fonctionnalités d'IA (Ask AI, l'assistant conversationnel, Build Solution with AI, les suggestions de correction et la réponse automatique du formulaire de support) sont imputées sur un quota quotidien unique par compte : par défaut 100 requêtes pour le personnel et pour toute personne ayant acheté des crédits au cours des 90 derniers jours, 20 pour les autres, dans la limite d'un plafond global quotidien sur toute la plateforme (1 000 par défaut). Finance configure ces limites dans **Credit Settings** — voir le [Guide finance](finance-guide.md#credit-settings).
- **Un seul e-mail de relance.** Un client en libre-service dont le déploiement a échoué il y a 24 à 72 heures, qui demeure en échec et qui ne s'est pas reconnecté depuis, reçoit un unique e-mail concis exposant la cause probable et la marche à suivre — au maximum un par déploiement et un par semaine par client, jamais pour le personnel ni pour un lab, et seulement si ses e-mails de déploiement sont activés.
- **L'évitement de tickets est mesuré.** Chaque fois que le diagnostic est présenté avant la création d'un ticket, et chaque fois que le client sélectionne **Yes, I'll try this** ou choisit d'envoyer le ticket malgré tout, une entrée d'audit `SUPPORT_DEFLECTION` est enregistrée (`shown`, `resolved` ou `filed`).
- **Vérification du statut (Check status).** Vous pouvez utiliser **Check status** sur tout déploiement affichant l'état Queued, Pending, Working ou Deleting depuis plus longtemps que le seuil de blocage défini (30 minutes par défaut, le même seuil que celui utilisé par le nettoyage automatique). L'outil ne rectifie le statut que si Cloud Build confirme qu'aucun build n'est en cours pour celui-ci, n'interrompt jamais un build actif, et génère une entrée d'audit `DEPLOYMENT_STATUS_RECHECKED`. Les propriétaires peuvent exécuter la même action sur leurs propres déploiements, évitant ainsi d'avoir à solliciter un administrateur pour forcer une suppression.
- **Destruction des services partagés.** Lorsque la suppression de **Services_GCP** échoue parce que Google n'a pas encore libéré les adresses réseau de Cloud Run, RAD retente automatiquement la suppression après un délai minimal de 30 minutes, deux fois au maximum, et prévient le propriétaire par e-mail.

### Surveillance des défaillances de modules {#module-failure-monitoring}

RAD surveille également les modules qui échouent pour de multiples clients. Chaque build client en échec fait l'objet d'une empreinte générée à partir de son erreur, après suppression des identifiants de projet, adresses e-mail, noms de buckets, hôtes et autres données identifiantes, de manière à ce qu'une même anomalie rencontrée par différents clients corresponde à une signature unique. Dès qu'une signature est relevée sur trois déploiements distincts, une issue est ouverte dans le dépôt GitHub de la plateforme, avec les étiquettes `build-failure` et `module:<name>` ; elle mentionne le module, les volumes constatés et une signature anonymisée, sans jamais inclure d'informations sur un déploiement, un projet ou une adresse e-mail. En parallèle, une alerte se déclenche (selon ses seuils par défaut) pour tout module subissant cinq échecs ou plus de création ou de mise à jour provenant d'au moins trois utilisateurs différents sur une période de six heures, ce qui permet de détecter sans délai un module tombé en panne de manière généralisée. Les échecs de destruction ne sont pas comptabilisés dans cette alerte, certaines destructions de services partagés pouvant échouer de manière normale.

## Journal d'audit (Audit Log) {#audit-log}

Ouvrez **Audit Log** depuis la barre de navigation pour examiner l'ensemble des actions réalisées sur la plateforme. Il recense chaque action enregistrée, de la plus récente à la plus ancienne : modifications de rôles et de comptes, changements de paramètres, attributions et ajustements de crédits, suppressions forcées, affichages de secrets, règlements et activités des sessions de lab. Chaque ligne précise l'horodatage, l'action effectuée et son auteur (**System** pour les jobs planifiés).

- La page s'ouvre sur les 7 derniers jours. Modifiez les dates, sélectionnez une action dans **Action**, ou saisissez une partie d'une adresse e-mail dans **Performed by**, puis cliquez sur **Load**. La période interrogée peut s'étendre jusqu'à un an.
- Cliquez sur **Show all** sur une ligne pour afficher l'ensemble des données enregistrées. Les valeurs secrètes ne sont jamais consignées ; un secret modifié apparaît masqué (redacted).
- Les résultats sont paginés à l'aide de la commande standard située sous le tableau ; vous pouvez afficher 25, 50, 100 ou 200 lignes par page.
- Si une plage contient plus d'actions qu'un seul chargement ne peut en traiter, seules les plus récentes sont affichées et un message vous invite à réduire la plage de dates.

Finance dispose également d'un onglet **Audit Log**, restreint aux opérations financières. Le journal est en lecture seule : personne, y compris les administrateurs, ne peut modifier ou supprimer une entrée.

## Obtenir de l'aide {#getting-help}

Sur la page **Help**, votre onglet **Send Message** affiche le formulaire de message décrit plus haut, et non le formulaire de demande de support que voient les autres utilisateurs, vous n'avez donc pas d'onglet My Tickets ; les onglets Setup Requests et Support Tickets se trouvent à côté. **Calculate ROI** est un onglet sur la page **Credits** (crédits). Le lien **Contact Us** dans le pied de page renvoie également vers Help. Pour la connexion, la navigation et les concepts fondamentaux tels que le déploiement de modules et les crédits, consultez [Utiliser RAD](using-rad.md).
