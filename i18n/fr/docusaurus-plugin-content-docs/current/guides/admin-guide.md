---
title: "Guide de l'administrateur"
description: "Guide de l'administrateur de la plateforme RAD — gestion des utilisateurs et des rôles, des paramètres de la plateforme, du catalogue de modules, des demandes de configuration et des tickets de support, et supervision des revenus, des coûts et de l'audit."
---

<!-- translated-from: docs/guides/admin-guide.md @ 15fd4c7 sha256:e2659f84fefc -->

# Guide de l'administrateur {#administrator-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Admin_Guide.png" alt="Guide de l'administrateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Pour les administrateurs qui gèrent la plateforme RAD : gestion des utilisateurs, des rôles, des crédits, des modules, des demandes et de la supervision. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

En tant qu'administrateur, vous avez un accès superutilisateur. En plus de tout ce qu'un utilisateur standard peut faire (construire une solution à partir d'une description, parcourir le catalogue de modules sur **Solutions → Solution Catalog → RAD modules**, configurer et déployer, gérer vos propres **Deployments**, utiliser les **Credits**, et l'onglet **Calculate ROI** sur la page **Credits**), vous pouvez :

- Afficher, rechercher, créer, modifier, activer/désactiver et supprimer des **Users**.
- Modifier les indicateurs de rôle de n'importe quel utilisateur (User, Partner, Agent, Finance, Support, Trainer, Admin) et les soldes de crédits de n'importe quel autre utilisateur.
- Attribuer des crédits en masse et envoyer des messages aux utilisateurs.
- Configurer le comportement de la plateforme sur la page **Setup**, y compris l'activation ou la désactivation des **Credits**.
- Synchroniser les **modules de la plateforme** dans le catalogue à partir de leur dépôt GitHub.
- Gérer les **Setup Requests** et les **Support Tickets** (onglets sur la page **Help**).
- Voir tous les revenus, coûts, factures et paiements sur l'ensemble de la plateforme.
- Examiner l'**Audit Log** : chaque action enregistrée sur la plateforme, qui l'a effectuée et quand.

Après vous être connecté, vous arrivez sur la page **Users**. Votre navigation supérieure affiche : Deployments, Solutions, Setup, Users, Audit Log, Sync, Pricing et Help, plus **Credits** (en premier) si votre compte détient également le rôle User, Partner ou Agent (et que les crédits sont activés). Le catalogue de modules est **RAD modules** dans l'onglet **Solution Catalog** de Solutions ; il n'a plus sa propre entrée de menu. Les Setup Requests et les Support Tickets sont des onglets de la page **Help** plutôt que des éléments de navigation de premier niveau.

## Gestion des utilisateurs {#managing-users}

Allez sur la page **Users** pour gérer tout le monde sur la plateforme.

**Afficher et rechercher.** Vous voyez une liste paginée et consultable de tous les utilisateurs enregistrés. Recherchez un utilisateur par e-mail — le filtre reste en place après avoir enregistré une modification, de sorte que l'utilisateur que vous avez modifié reste à l'écran — puis lisez sa ligne : des badges de rôle à côté de l'adresse, et une colonne pour son statut actif et pour chaque rôle (Admin, User, Partner, Agent, Finance, Support, Trainer). Les soldes de crédits ne sont pas affichés ici.

**Créer un utilisateur.** Activez le **Private Mode** dans **Setup** et deux boutons apparaissent au-dessus de la liste des utilisateurs. **Add New User** crée un compte directement afin que cette personne puisse se connecter. **Restore User** réadmet une personne que vous avez précédemment supprimée, effaçant l'enregistrement qui bloquait son e-mail — elle ne reçoit pas de nouveaux crédits d'inscription. Aucun bouton n'apparaît, et aucune action n'est acceptée, tant que la plateforme est en mode public, car les gens peuvent s'inscrire eux-mêmes.

**Modifier les rôles.** Sélectionnez **Edit** sur la ligne d'un utilisateur, puis définissez :

- Statut **Active** — voir Activer/désactiver ci-dessous.
- **Role flags** — Admin, User, Partner, Agent, Support et Trainer sont toujours affichés. **Finance** apparaît seulement une fois que **Enable Subscription** est activé dans **Setup**. La case **Agent** ne peut être cochée que si les utilisateurs peuvent payer (voir [Attribution des rôles](#assigning-roles)).

Sélectionnez **Save** pour appliquer vos modifications.

**La modification des crédits se fait ailleurs.** Les soldes par utilisateur se trouvent dans l'onglet **Credit Management** de la page **Billing**, qui modifie séparément les Awards, l'Subscription, le Top-up et l'attribution mensuelle du Partner. Personne — y compris les administrateurs — ne peut modifier son propre solde ; demandez à un autre administrateur ou à un utilisateur financier, afin que l'enregistrement porte deux identités. Pour la même raison, les comptes administrateur et financier ne peuvent pas réclamer de **codes d'événement**, et personne ne peut réclamer un code qu'il a créé.

**Activer ou désactiver.** Basculez le statut actif d'un utilisateur pour accorder ou révoquer l'accès. La désactivation efface tous les rôles non-administrateur détenus par le compte (User, Partner, Agent, Finance, Support, Trainer) et son attribution mensuelle de partenaire ; la réactivation ne réactive que **User**, donc réattribuez tout autre rôle manuellement. Des mesures de protection s'appliquent : vous ne pouvez pas désactiver un compte qui détient le rôle Admin.

**Supprimer un utilisateur.** La suppression d'un utilisateur supprime définitivement ses modules et ses déploiements, puis supprime le compte. Un utilisateur ayant un déploiement actif (pas encore détruit) ne peut pas être supprimé — détruisez-les d'abord. Un enregistrement minimal est conservé uniquement pour empêcher la réinscription de la même adresse e-mail, et l'historique des transactions de crédit est conservé pour les audits.

**Mesures de protection à connaître.**

- Vous ne pouvez pas désactiver un administrateur.
- Vous ne pouvez pas supprimer le dernier administrateur de la plateforme, et vous ne pouvez pas non plus supprimer le compte du dernier administrateur.
- Un administrateur fondateur (bootstrap) ne peut pas voir son rôle d'administrateur révoqué et ne peut pas être supprimé. Supprimez d'abord son e-mail de la liste blanche des administrateurs bootstrap, puis réessayez.
- Personne ne peut modifier son propre solde de crédits, y compris les administrateurs.
- Il n'y a aucun moyen de se connecter en tant qu'autre utilisateur, ou d'emprunter son identité. La supervision de l'administrateur se fait via les pages Users, Deployments et de reporting, et non en agissant comme quelqu'un d'autre.

## Attribution des rôles {#assigning-roles}

RAD a sept rôles : **User, Admin, Partner, Agent, Finance, Support, Trainer**. Une personne peut en détenir plusieurs à la fois (par exemple Agent + Partner), et son menu combine tous les rôles qu'elle détient. Un Partner ou un Trainer est toujours aussi un User. Les rôles sont accordés par un administrateur via la page **Users** et stockés dans l'enregistrement du compte de l'utilisateur (l'administrateur fondateur est épinglé via une liste blanche de bootstrap).

Définissez les rôles d'un utilisateur en modifiant sa ligne sur la page **Users** et en basculant les indicateurs de rôle. Ce que chaque rôle débloque :

- **User** — le rôle par défaut. Déployer des modules et gérer ses propres déploiements et crédits.
- **Admin** — administration complète de la plateforme (ce guide).
- **Partner** — publier des modules à partir de son propre dépôt et générer des revenus de partenaire. L'octroi du rôle Partner est manuel ; la souscription à un plan de crédits ne l'accorde pas.
- **Agent** — un rôle commercial : gagne une commission en argent sur les frais de module que ses utilisateurs parrainés paient avec des crédits achetés, suivi sur **Credits → My Commission** (voir le [Guide de l'agent](agent-guide.md)). Il ne peut être accordé que si les utilisateurs peuvent **acheter des crédits ou s'abonner**, ce qui signifie que les crédits sont activés et que Stripe ou Flutterwave est activé. Si les paiements sont désactivés, la case reste verrouillée et une note explique pourquoi. Un agent existant peut toujours être décoché, et conserve le rôle si les paiements sont désactivés ultérieurement. La **désactivation** du compte d'un agent arrête sa commission : rien de nouveau n'est enregistré, et ce qui est déjà enregistré est retenu des paiements jusqu'à ce que le compte soit réactivé.
- **Finance** — rapports financiers et paiements ; utilise la page **Billing**.
- **Support** — triage des **Support Tickets** (un onglet de la page Help). Un agent de support ne voit les déploiements que pour les clients dont les tickets ouverts lui sont attribués, et jamais les variables ou les sorties d'un déploiement. La résolution ou la fermeture du ticket met fin à cet accès.
- **Trainer** — exécute des **sessions de lab** à partir de **Solutions → Managed Environments** : inscrit une cohorte de participants, les finance ou les fait acheter leur propre place, et construit un environnement de lab par participant. Le rôle est l'octroi complet — il n'y a pas de liste à remplir — donc le décocher supprime l'accès. La désactivation d'un compte l'efface également, et la réactivation ne le restaure pas. Un formateur est toujours traité comme un utilisateur également, il conserve donc les pages de l'utilisateur, y compris **Credits**, qui finance ses sessions. Contrairement au Support, un formateur peut mettre à jour et détruire les environnements de lab qu'il a provisionnés, de sorte qu'un cours ne laisse pas d'infrastructure derrière lui. Un formateur peut voir les sorties d'un environnement de lab (avec les valeurs sensibles supprimées) mais jamais ses variables de configuration ou ses identifiants générés, ne voit jamais les déploiements personnels d'un participant, et ne peut pas déployer au nom de quelqu'un d'autre à partir du formulaire de déploiement ordinaire.

Voir le [Guide du formateur](trainer-guide.md) pour le point de vue du formateur.

### Intégration d'un partenaire {#onboarding-a-partner}

Faire de quelqu'un un partenaire se fait en trois étapes, et la dernière est la vôtre :

1. Cochez **Partner** sur sa ligne sur la page **Users**.
2. Le partenaire connecte son dépôt GitHub depuis son **Profile** (en installant l'application GitHub RAD Module Sync, puis en choisissant le dépôt). Cela permet à RAD de **lire** ses modules, afin qu'il puisse les synchroniser et les voir listés — voir le [Guide du partenaire](partner-guide.md).
3. **Activer les déploiements de leurs modules.** La création d'un déploiement clone le dépôt du partenaire avec un identifiant par partenaire que seul un administrateur peut créer. Dans le **Secret Manager** du projet de la plateforme RAD, créez un secret nommé `partner-github-token-<partner's user ID>` — l'ID est l'ID utilisateur Firebase Authentication du partenaire, la même valeur stockée sous le nom `partnerId` sur leurs modules — avec réplication automatique, contenant un jeton GitHub qui peut lire ce dépôt. Tant qu'il n'existe pas, tout déploiement des modules du partenaire (par le partenaire ou par un client) est refusé avec *"Deployment repository credentials are not configured"*, alors faites-le avant que le partenaire ne rende un module public.

La révocation du rôle Partner, ou la désactivation du compte, arrête leur attribution mensuelle de partenaire. Supprimez également le secret si le partenaire ne doit plus être déployable.

**Comment fonctionnent les sessions de lab.** Activez d'abord **Enable Lab Sessions** dans **Setup** ; tant qu'il est désactivé, les sessions de lab sont masquées dans **Solutions → Managed Environments**, l'entrée de menu **Labs** de Finance est masquée, et chaque route de lab répond *not found*. Les mêmes variables de Setup définissent les plafonds dans lesquels un formateur travaille : nombre maximum de participants, durée et crédits par participant, plus la concurrence de provisionnement.

Un formateur crée une session sur **Solutions → Managed Environments** (**Lab sessions → New lab session**) et choisit qui paie :
- **Les participants paient leur propre place.** C'est le comportement par défaut pour une nouvelle session. Chaque participant paie avec ses propres crédits achetés avant que quoi que ce soit ne soit construit pour lui. Lorsqu'un participant ne peut pas payer sur RAD (une banque que le fournisseur de paiement n'acceptera pas, ou de l'argent liquide), le formateur peut payer cette place avec ses propres crédits achetés via **Pay for place** ; la ligne affiche alors **Paid by trainer**. Seul le formateur de la session se voit proposer cette option, car cela dépense ses crédits.
- **Le formateur paie.** L'intégralité de l'allocation est réservée à l'avance sur les crédits achetés du formateur.

Chaque participant reçoit **un environnement** sur le palier **lab**, qui a son propre dossier, ses propres politiques d'organisation et son propre budget. Le palier lab n'est jamais proposé comme choix manuel sur aucun formulaire de déploiement. Les crédits inutilisés sont reversés au formateur une fois que Google a signalé les coûts de la session.

Vous pouvez voir et gérer les sessions de chaque formateur, et vous seul pouvez forcer un démantèlement. La Finance peut voir chaque session et en terminer une, mais ne peut pas la modifier. Vous seul pouvez déployer au nom de quelqu'un d'autre à partir du formulaire de déploiement ordinaire, et uniquement dans un projet géré par RAD : le déploiement de chaque participant va dans son propre projet et est payé par ce participant.

## Attribution de crédits en masse et envoi de messages aux utilisateurs {#bulk-credit-awards-and-messaging-users}

Deux actions en masse sont à votre disposition, et aucune ne se trouve sur la page Users :

- **Attribuer des crédits en masse** — l'onglet **Credit Settings** de la page **Billing**. L'ajustement s'applique à *tous* les utilisateurs à la fois ; vous ne pouvez pas choisir un sous-ensemble. Saisissez un montant positif pour accorder ou un montant négatif pour déduire, et choisissez s'il s'agit de crédits offerts gratuits ou de crédits achetés. Les montants de 10 000 ou plus nécessitent une raison et une confirmation tapée, et les crédits doivent être activés à l'échelle de la plateforme. Pour modifier le solde d'une seule personne, utilisez **Credit Management** sur la même page.
- **Envoyer un message aux utilisateurs** — l'onglet **Send Message** de la page **Help**, qui vous affiche un formulaire de message plutôt que le formulaire de support que les autres utilisateurs voient. Envoyez à tous les utilisateurs, ou recherchez et sélectionnez jusqu'à 100 destinataires (la recherche correspond à n'importe quelle partie d'une adresse e-mail, donc un domaine trouve tout le monde) ; les messages sont limités à 5 000 caractères.

Ce sont les moyens les plus rapides d'organiser des promotions, de recharger les soldes après une panne ou d'envoyer une annonce à l'échelle de la plateforme.

## Paramètres de la plateforme (Setup) {#platform-settings-setup}

La page **Setup** est l'endroit où vous configurez le comportement de l'ensemble de la plateforme. Ajustez les paramètres ici chaque fois que vous avez besoin de modifier le fonctionnement de la plateforme, puis enregistrez.

Les contrôles clés à votre disposition incluent l'activation ou la désactivation des **Credits** pour l'ensemble de la plateforme. Lorsque les crédits sont désactivés, la page Credits et les coûts de crédit sont masqués pour les utilisateurs ; lorsqu'ils sont activés, les déploiements sont mesurés en crédits comme décrit dans [Utiliser RAD](using-rad.md).

**Enable Subscription** est, malgré son nom, l'interrupteur pour chaque achat. S'il est désactivé, personne ne peut démarrer un nouvel abonnement **ou** un réapprovisionnement unique : les deux fournisseurs de paiement sont désactivés, les routes de paiement refusent, les liens *Buy credits* et *Subscribe* disparaissent de l'application, et les pages publiques **Pricing** et de connexion cessent de lister les plans. Les paiements déjà effectués sont toujours crédités, et les abonnés existants ne sont pas coupés : leur plan continue de se renouveler jusqu'à ce qu'ils l'annulent, ce qu'ils peuvent toujours faire depuis la page **Credits**.

**Enforce Update Safe** contrôle ce qui se passe lorsque quelqu'un modifie un paramètre qui ne peut pas être modifié sur un déploiement en cours — une région, une clé de chiffrement, un interrupteur qui crée ou détruit une ressource. Les modules déclarent lesquels de leurs paramètres peuvent être modifiés en place ; tout le reste est traité comme destructeur.

- **Désactivé (par défaut)** — le champ reste modifiable et sa modification déclenche une confirmation nommant exactement les paramètres qui reconstruiront les ressources. L'utilisateur décide.
- **Activé** — ces champs sont en lecture seule lors de la mise à jour d'un déploiement existant, de sorte que la modification de l'un d'entre eux signifie la suppression et le redéploiement. Les administrateurs et les partenaires sont exemptés.

Activez-le là où une reconstruction accidentelle est coûteuse — environnements partagés, déploiements orientés client, cohortes de formation. Laissez-le désactivé là où les utilisateurs sont censés remodeler leurs propres déploiements.

## Gestion des modules {#managing-modules}

Vous êtes responsable du catalogue de **modules de la plateforme** que chaque utilisateur voit sur **Solutions → Solution Catalog → RAD modules**.

**Synchroniser les modules de la plateforme.** Allez sur la page **Sync** pour intégrer les modules de la plateforme au catalogue. La page est une console de synchronisation en lecture seule : elle liste les modules trouvés dans le dépôt de la plateforme, et l'action **Sync Now** actualise le catalogue à partir de ce dépôt. Les modules eux-mêmes sont gérés dans le dépôt, et non modifiés sur cette page.

**Mettre à jour un module.** Modifiez le module dans le dépôt, puis exécutez **Sync Now** depuis la page Sync pour actualiser sa définition (description, champs de configuration et coût en crédits) dans le catalogue.

**Supprimer un module.** La gestion des modules est en lecture seule par défaut : le paramètre **Module Console Read-Only** de la page **Setup** est activé par défaut, ce qui masque l'action de suppression sur les cartes de module et sur la page d'un module, et fait en sorte que la plateforme rejette une suppression de console. Pour supprimer un module, supprimez-le de son dépôt GitHub et laissez la prochaine synchronisation le supprimer du catalogue. Ce n'est que si vous désactivez ce paramètre qu'une action de suppression apparaît — et alors vous pouvez supprimer n'importe quel module, plateforme ou publié par un partenaire. S'il est désactivé, l'entrée de menu **Sync** devient **Publish**.

## Demandes de configuration {#setup-requests}

L'onglet **Setup Requests** de la page **Help** est l'endroit où les demandes de configuration gérées sont traitées. Examinez les demandes entrantes, attribuez un ingénieur (qui doit être un compte partenaire existant), suivez leur statut et suivez-les jusqu'à leur achèvement. Lorsqu'une demande est terminée, ses revenus sont répartis à 75 % pour l'ingénieur et à 25 % pour la plateforme, à moins que le paramètre de la plateforme `platformRevenueSharePct` (audité comme *Platform revenue share (setup requests)* ; il n'a pas encore de contrôle de formulaire) ne contienne une autre valeur entre 0 et 100. La Finance a également accès à cet onglet ; en tant qu'administrateur, vous avez une visibilité complète sur toutes les demandes. Les utilisateurs ayant le rôle Support ne voient pas les Setup Requests — les demandes contiennent des chiffres de revenus et de paiements aux partenaires.

## Tickets de support {#support-tickets}

L'onglet **Support Tickets** de la page **Help** liste les tickets ouverts via le formulaire **Help**. Triez chaque ticket : mettez à jour son statut (nouveau, en cours, résolu, fermé), ajoutez des notes et attribuez-le. Les utilisateurs ayant le rôle Support travaillent également sur cette file d'attente ; en tant qu'administrateur, vous voyez tous les tickets. Le client suit son ticket sur son propre onglet **My Tickets**, qui affiche le statut que vous avez défini mais jamais vos notes ou à qui le ticket est attribué.

## Visibilité sur les revenus, les coûts, les factures et les paiements {#visibility-into-revenue-costs-invoices-and-payouts}

Vous avez une visibilité financière à l'échelle de la plateforme :

- **Revenus** — **Module Revenue** (frais de module et parts de revenus des partenaires) et **Agent Revenue** (le relevé de commission de l'agent, où une commission peut être annulée avec une raison, et les lots de paiement des agents qui sont créés avec une date limite et marqués comme payés avec une référence de paiement ; les agents sont payés en dehors de RAD).
- **Coûts et factures** — **Project Transactions** et **Project Invoices** (coût réel du cloud par projet par mois) ; les deux nécessitent **Enable Project Credits**. Les coûts des modules par déploiement se trouvent dans l'onglet **Module Costs** de la page **Credits**.
- **Paiements** — **Payout Summary**, totaux par bénéficiaire pour les agents et les partenaires. **Mark paid** enregistre le paiement d'un partenaire pour une période terminée, une fois, au taux en vigueur ; les agents sont payés via Agent Revenue à la place.

À l'exception des coûts des modules, ces rapports sont des onglets de la page **Billing**. Deux choses à savoir avant de les chercher : votre navigation administrateur n'a pas d'entrée Billing, alors accordez-vous le rôle Finance également (ce qui l'ajoute) ou allez directement à `/billing` ; et chaque onglet Billing sauf **Event Codes** nécessite **Enable Subscription** dans **Setup**, donc si celui-ci est désactivé, la page s'ouvre sur Event Codes et n'affiche rien d'autre. Trois onglets Billing sont réservés à la Finance et ne sont pas affichés aux administrateurs : **Linked Projects** (approbation des demandes des clients pour que RAD paie leurs propres projets Google Cloud), **Customer Billing** (taux de TVA de chaque client, détails fiscaux et sous-compte de facturation) et **VAT Report** — voir le [Guide de la Finance](finance-guide.md#linked-projects-customer-billing-and-vat). Utilisez-les pour surveiller la santé de la plateforme, rapprocher les gains des partenaires et des agents, et examiner les dépenses du projet.

## Journal d'audit {#audit-log}

Ouvrez l'**Audit Log** depuis la barre de navigation pour examiner ce qui a été fait sur la plateforme. Il liste chaque action enregistrée, la plus récente en premier : changements de rôle et de compte, changements de paramètres, octrois et ajustements de crédits, suppressions forcées, révélations d'identifiants, paiements et activité des sessions de lab. Chaque ligne indique quand cela s'est produit, l'action et qui l'a effectuée (**System** pour les jobs planifiés).

- La page s'ouvre sur les 7 derniers jours. Modifiez les dates, choisissez une **Action**, ou tapez une partie d'un e-mail dans **Performed by**, puis sélectionnez **Load**. La plage peut aller jusqu'à un an.
- Sélectionnez **Show all** sur une ligne pour voir tout ce qui y est enregistré. Les valeurs secrètes ne sont jamais enregistrées ; un secret modifié apparaît comme masqué.
- Les résultats sont paginés avec le contrôle standard sous le tableau ; choisissez 25, 50, 100 ou 200 lignes par page.
- Si une plage contient plus d'actions qu'un chargement ne peut en lire, seules les plus récentes sont affichées et une notification vous demande de réduire les dates.

La Finance a également un **Audit Log**, limité aux actions liées à l'argent. Le journal est en lecture seule : personne, y compris les administrateurs, ne peut modifier ou supprimer une entrée.

## Obtenir de l'aide {#getting-help}

Sur la page **Help**, votre onglet **Send Message** affiche le formulaire de message décrit ci-dessus, et non le formulaire de demande de support que les autres utilisateurs voient, vous n'avez donc pas d'onglet My Tickets ; les onglets Setup Requests et Support Tickets se trouvent à côté. **Calculate ROI** est un onglet de la page **Credits**. Le lien **Contact Us** dans le pied de page renvoie également à Help. Pour la connexion, la navigation et les concepts fondamentaux comme le déploiement de modules et les crédits, voir [Utiliser RAD](using-rad.md).
