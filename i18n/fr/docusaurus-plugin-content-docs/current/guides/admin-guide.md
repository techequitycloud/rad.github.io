---
title: "Guide de l'administrateur"
description: "Guide de l'administrateur de la plateforme RAD — gestion des utilisateurs et des rôles, paramètres de la plateforme, catalogue de modules, demandes de configuration et tickets de support, et supervision des revenus, des coûts et de l'audit."
---
<!-- translated-from: docs/guides/admin-guide.md @ 6b90c32 sha256:c52c4a1d0ca8 -->

# Guide de l'administrateur {#administrator-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Admin_Guide.png" alt="Guide de l'administrateur" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse aux administrateurs qui exploitent la plateforme RAD : gestion des utilisateurs, des rôles, des crédits, des modules, des demandes et de la supervision. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

## Ce que vous pouvez faire {#what-you-can-do}

En tant qu'administrateur, vous disposez d'un accès superutilisateur. En plus de tout ce qu'un utilisateur standard peut faire (construire une solution à partir d'une description, parcourir le catalogue de modules sous **Solutions → Solution Catalog → RAD modules**, configurer et déployer, gérer vos propres **Deployments** (déploiements), utiliser les **Credits** (crédits) et l'onglet **Calculate ROI** de la page **Credits**), vous pouvez :

- Consulter, rechercher, créer, modifier, activer/désactiver et supprimer des **Users** (utilisateurs).
- Modifier les indicateurs de rôle de n'importe quel utilisateur (User, Partner, Agent, Finance, Support, Trainer, Admin), ainsi que les soldes de crédits de tout autre utilisateur.
- Attribuer des crédits en masse et envoyer des messages aux utilisateurs.
- Configurer le comportement global de la plateforme sur la page **Setup** (configuration), notamment activer ou désactiver les **Credits**.
- Synchroniser les **modules de la plateforme** dans le catalogue depuis leur dépôt GitHub.
- Traiter les **Setup Requests** (demandes de configuration) et les **Support Tickets** (tickets de support), qui sont des onglets de la page **Help** (aide).
- Consulter l'ensemble des revenus, coûts, factures et versements de la plateforme.
- Examiner l'**Audit Log** (journal d'audit) : chaque action enregistrée sur la plateforme, qui l'a effectuée et quand.

Après la connexion, vous arrivez sur la page **Users**. Votre barre de navigation supérieure affiche : Deployments, Solutions, Setup, Users, Audit Log, Sync et Help, ainsi que **Credits** (en premier) si votre compte détient aussi le rôle User, Partner ou Agent (et si les crédits sont activés). Le catalogue de modules correspond à **RAD modules** dans l'onglet **Solution Catalog** de Solutions ; il n'a plus d'entrée de menu propre. Setup Requests et Support Tickets sont des onglets de la page **Help**, et non des éléments de navigation de premier niveau.

## Gérer les utilisateurs {#managing-users}

Rendez-vous sur la page **Users** pour gérer toutes les personnes présentes sur la plateforme.

**Consulter et rechercher.** Vous voyez une liste paginée et consultable de tous les utilisateurs inscrits. Recherchez un utilisateur par son adresse e-mail, puis lisez sa ligne : les badges de rôle à côté de l'adresse, une colonne pour son statut actif et une pour chaque rôle (Admin, User, Partner, Agent, Finance, Support, Trainer). Les soldes de crédits n'apparaissent pas ici.

**Créer un utilisateur.** Activez le **Private Mode** (mode privé) dans **Setup** : deux boutons apparaissent au-dessus de la liste des utilisateurs. **Add New User** crée directement un compte afin que la personne puisse se connecter. **Restore User** réadmet une personne que vous avez supprimée auparavant, en effaçant l'enregistrement qui bloquait son adresse e-mail — elle ne reçoit pas de nouveaux crédits d'inscription. Aucun des deux boutons n'apparaît, et aucune des deux actions n'est acceptée, tant que la plateforme est en mode public, car chacun peut alors s'inscrire lui-même.

**Modifier les rôles.** Sélectionnez **Edit** sur la ligne d'un utilisateur, puis définissez :

- le statut **Active** (actif) — voir Activer/désactiver ci-dessous ;
- les **indicateurs de rôle** — Admin, User, Partner, Agent, Support et Trainer sont toujours affichés. **Finance** n'apparaît qu'une fois **Enable Subscription** activé dans **Setup**. La case **Agent** ne peut être cochée que tant que les utilisateurs peuvent payer (voir [Attribuer des rôles](#assigning-roles)).

Sélectionnez **Save** pour appliquer vos modifications.

**La modification des crédits se fait ailleurs.** Les soldes par utilisateur se trouvent dans l'onglet **Credit Management** de la page **Billing** (facturation), qui permet de modifier séparément les soldes Awards, Subscription, Top-up et l'allocation Monthly Partner. Personne — administrateurs compris — ne peut modifier son propre solde ; demandez à un autre administrateur ou à un utilisateur Finance, afin que l'enregistrement porte deux identités. Pour la même raison, les comptes administrateur et Finance ne peuvent pas utiliser de **codes d'événement**, et personne ne peut utiliser un code qu'il a lui-même créé.

**Activer ou désactiver.** Basculez le statut actif d'un utilisateur pour accorder ou retirer l'accès. La désactivation retire tous les rôles non administrateur détenus par le compte (User, Partner, Agent, Finance, Support, Trainer) ainsi que son allocation mensuelle de partenaire ; la réactivation ne rétablit que le rôle **User**, vous devez donc réattribuer manuellement tout autre rôle. Des garde-fous s'appliquent : vous ne pouvez pas désactiver un compte qui détient le rôle Admin.

**Supprimer un utilisateur.** La suppression d'un utilisateur supprime définitivement ses modules et ses déploiements, puis le compte lui-même. Un utilisateur ayant un déploiement actif (pas encore détruit) ne peut pas être supprimé — détruisez d'abord ces déploiements. Un enregistrement minimal est conservé uniquement pour empêcher la même adresse e-mail de se réinscrire, et l'historique des transactions de crédits est préservé à des fins d'audit.

**Garde-fous à connaître.**

- Vous ne pouvez pas désactiver un administrateur.
- Vous ne pouvez pas retirer le dernier administrateur de la plateforme, ni supprimer le compte du dernier administrateur.
- Un administrateur fondateur (bootstrap) ne peut ni se voir retirer son rôle d'administrateur, ni être supprimé. Retirez d'abord son adresse e-mail de la liste d'autorisation des administrateurs bootstrap, puis réessayez.
- Personne ne peut modifier son propre solde de crédits, administrateurs compris.
- Il n'existe aucun moyen de se connecter en tant qu'un autre utilisateur, ni d'emprunter son identité. La supervision administrateur s'effectue via les pages Users, Deployments et les pages de rapports, et non en agissant à la place de quelqu'un d'autre.

## Attribuer des rôles {#assigning-roles}

RAD comporte sept rôles : **User, Admin, Partner, Agent, Finance, Support, Trainer**. Une personne peut en détenir plusieurs à la fois (par exemple Agent + Partner), et son menu combine tous les rôles qu'elle détient. Un Partner ou un Trainer est toujours aussi un User. Les rôles sont attribués par un administrateur via la page **Users** et enregistrés sur la fiche du compte de l'utilisateur (l'administrateur fondateur est fixé via une liste d'autorisation bootstrap).

Définissez les rôles d'un utilisateur en modifiant sa ligne sur la page **Users** et en basculant les indicateurs de rôle. Ce que chaque rôle débloque :

- **User** — le rôle par défaut. Déployer des modules et gérer ses propres déploiements et crédits.
- **Admin** — administration complète de la plateforme (ce guide).
- **Partner** — publier des modules depuis son propre dépôt et percevoir des revenus de partenaire. L'attribution du rôle Partner est manuelle ; souscrire une formule de crédits ne l'accorde pas.
- **Agent** — un rôle commercial : perçoit une commission en argent sur les frais de module que ses utilisateurs parrainés paient avec des crédits achetés, suivie dans **Credits → My Commission** (voir le [Guide de l'agent](agent-guide.md)). Il ne peut être attribué que tant que les utilisateurs peuvent **acheter des crédits ou souscrire un abonnement**, c'est-à-dire lorsque les crédits sont activés et que Stripe ou Flutterwave est activé. Lorsque les paiements sont désactivés, la case reste verrouillée et une note en explique la raison. Un agent existant peut toujours être décoché, et il conserve le rôle si les paiements sont désactivés ultérieurement. **Désactiver** le compte d'un agent interrompt sa commission : rien de nouveau n'est enregistré, et ce qui est déjà enregistré est retenu sur les versements jusqu'à la réactivation du compte.
- **Finance** — rapports financiers et versements ; utilise la page **Billing**.
- **Support** — tri des **Support Tickets** du help desk (un onglet de la page Help). Un agent de support ne voit les déploiements que des clients dont les tickets ouverts lui sont attribués, et jamais les variables ni les sorties d'un déploiement. La résolution ou la clôture du ticket met fin à cet accès.
- **Trainer** — anime des **sessions de lab** depuis **Solutions → Managed Environments** : inscrit une cohorte de participants, les finance ou leur fait acheter leur propre place, et construit un environnement de lab par participant. Le rôle constitue l'intégralité de l'autorisation — il n'y a pas de liste de participants à renseigner —, si bien que le décocher retire l'accès. La désactivation d'un compte le retire également, et la réactivation ne le rétablit pas. Un formateur est toujours considéré aussi comme un utilisateur ; il conserve donc les pages de l'utilisateur, y compris **Credits**, qui finance ses sessions. Contrairement au Support, un formateur peut mettre à jour et détruire les environnements de lab qu'il a provisionnés, afin qu'un cours ne laisse pas d'infrastructure derrière lui. Un formateur peut voir les sorties d'un environnement de lab (sans les valeurs sensibles), mais jamais ses variables de configuration ni ses identifiants générés ; il ne voit jamais les déploiements personnels d'un participant et ne peut pas déployer pour le compte d'autrui depuis le formulaire de déploiement ordinaire.

Consultez le [Guide du formateur](trainer-guide.md) pour le point de vue du formateur.

### Intégrer un partenaire {#onboarding-a-partner}

Faire de quelqu'un un partenaire se fait en trois étapes, et la dernière vous revient :

1. Cochez **Partner** sur sa ligne dans la page **Users**.
2. Le partenaire connecte son dépôt GitHub depuis son **Profile** (profil) en installant la GitHub App RAD Module Sync, puis en choisissant le dépôt. Cela permet à RAD de **lire** ses modules, afin qu'il puisse les synchroniser et les voir listés — voir le [Guide du partenaire](partner-guide.md).
3. **Activez les déploiements de ses modules.** La construction d'un déploiement clone le dépôt du partenaire à l'aide d'un identifiant propre à chaque partenaire, que seul un administrateur peut créer. Dans le **Secret Manager** du projet de la plateforme RAD, créez un secret nommé `partner-github-token-<partner's user ID>` — l'ID est l'identifiant utilisateur Firebase Authentication du partenaire, la même valeur que celle enregistrée comme `partnerId` sur ses modules — avec réplication automatique, contenant un jeton GitHub capable de lire ce dépôt. Tant qu'il n'existe pas, tout déploiement des modules du partenaire (par le partenaire ou par un client) est refusé avec le message *« Deployment repository credentials are not configured »* ; faites donc cela avant que le partenaire ne rende un module public.

Retirer le rôle Partner, ou désactiver le compte, interrompt son allocation mensuelle de partenaire. Supprimez également le secret si les modules du partenaire ne doivent plus pouvoir être déployés.

**Fonctionnement des sessions de lab.** Activez d'abord **Enable Lab Sessions** dans **Setup** ; tant que ce paramètre est désactivé, les sessions de lab sont masquées dans **Solutions → Managed Environments**, l'entrée de menu **Labs** de Finance est masquée, et toutes les routes de lab répondent *introuvable*. Les mêmes variables de Setup fixent les plafonds dans lesquels travaille un formateur : nombre maximal de participants, durée et crédits par participant, ainsi que la concurrence de provisionnement.

Un formateur crée une session sous **Solutions → Managed Environments** (**Lab sessions → New lab session**) et choisit qui paie :
- **Les participants achètent leur propre place.** C'est le choix par défaut pour une nouvelle session. Chaque participant paie avec ses propres crédits achetés avant que quoi que ce soit ne soit construit pour lui. Lorsqu'un participant ne peut pas payer sur RAD (une banque que le prestataire de paiement n'accepte pas, ou un paiement en espèces), le formateur peut payer cette place avec ses propres crédits achetés via **Pay for place** ; la ligne affiche alors **Paid by trainer**. Seul le formateur de la session se voit proposer cette option, car elle dépense ses crédits.
- **Le formateur paie.** L'allocation complète est réservée d'avance sur les crédits achetés du formateur.

Chaque participant obtient **un environnement** sur le palier **lab**, qui dispose de son propre dossier, de ses propres règles d'administration (org policies) et de son propre budget. Le palier lab n'est jamais proposé comme choix manuel sur un formulaire de déploiement. Les crédits non utilisés reviennent au formateur une fois que Google a communiqué les coûts de la session.

Vous pouvez voir et gérer les sessions de tous les formateurs, et vous seul pouvez forcer une destruction. Finance peut voir toutes les sessions et en terminer une, mais ne peut pas la modifier. Vous seul pouvez déployer pour le compte d'autrui depuis le formulaire de déploiement ordinaire, et uniquement dans un projet géré par RAD : le déploiement de chaque participant est placé dans son propre projet et payé par ce participant.

## Attributions de crédits en masse et messages aux utilisateurs {#bulk-credit-awards-and-messaging-users}

Deux actions groupées sont à votre disposition, et aucune ne se trouve sur la page Users :

- **Attribuer des crédits en masse** — l'onglet **Credit Settings** de la page **Billing**. L'ajustement s'applique à *tous* les utilisateurs à la fois ; vous ne pouvez pas choisir un sous-ensemble. Saisissez un montant positif pour accorder ou négatif pour déduire, et choisissez s'il est versé sous forme de crédits offerts ou de crédits achetés. Les montants de 10 000 ou plus exigent un motif et une confirmation saisie, et les crédits doivent être activés sur l'ensemble de la plateforme. Pour modifier plutôt le solde d'une seule personne, utilisez **Credit Management** sur la même page.
- **Envoyer un message aux utilisateurs** — l'onglet **Send Message** de la page **Help**, qui vous présente un formulaire de message au lieu du formulaire de support que voient les autres utilisateurs. Envoyez à tous les utilisateurs, ou recherchez et sélectionnez jusqu'à 100 destinataires ; les messages sont limités à 5 000 caractères.

C'est le moyen le plus rapide de mener des promotions, de recharger des soldes après une panne ou d'envoyer une annonce à toute la plateforme.

## Paramètres de la plateforme (Setup) {#platform-settings-setup}

La page **Setup** est l'endroit où vous configurez le comportement global de la plateforme. Ajustez-y les paramètres chaque fois que vous devez modifier le fonctionnement de la plateforme, puis enregistrez.

Parmi les principales commandes à votre disposition figure l'activation ou la désactivation des **Credits** pour toute la plateforme. Lorsque les crédits sont désactivés, la page Credits et les coûts en crédits sont masqués pour les utilisateurs ; lorsqu'ils sont activés, les déploiements sont décomptés en crédits comme décrit dans [Utiliser RAD](using-rad.md).

**Enable Subscription** est, malgré son nom, l'interrupteur de tout achat. Désactivé, personne ne peut démarrer un nouvel abonnement **ni** une recharge ponctuelle : les deux prestataires de paiement sont désactivés, les routes de paiement refusent, les liens *Buy credits* et *Subscribe* disparaissent de toute l'application, et les pages publiques **Pricing** et de connexion cessent d'afficher les formules. Les paiements déjà effectués sont toujours crédités, et les abonnés existants ne sont pas coupés : leur abonnement continue de se renouveler jusqu'à ce qu'ils l'annulent, ce qu'ils peuvent toujours faire depuis la page **Credits**.

**Enforce Update Safe** détermine ce qui se passe lorsque quelqu'un modifie un paramètre qui ne peut pas être changé sur un déploiement en cours d'exécution — une région, une clé de chiffrement, une option qui crée ou détruit une ressource. Les modules déclarent lesquels de leurs paramètres peuvent être modifiés sans risque sur place ; tout le reste est considéré comme destructif.

- **Désactivé (par défaut)** — le champ reste modifiable, et sa modification déclenche une confirmation indiquant précisément quels paramètres reconstruiront des ressources. L'utilisateur décide.
- **Activé** — ces champs sont en lecture seule lors de la mise à jour d'un déploiement existant ; en modifier un implique donc de supprimer puis de redéployer. Les administrateurs et les partenaires en sont exemptés.

Activez-le là où une reconstruction accidentelle coûte cher — environnements partagés, déploiements exposés aux clients, cohortes de formation. Laissez-le désactivé là où les utilisateurs sont censés remodeler leurs propres déploiements.

## Gérer les modules {#managing-modules}

Vous êtes responsable du catalogue des **modules de la plateforme** que chaque utilisateur voit sous **Solutions → Solution Catalog → RAD modules**.

**Synchroniser les modules de la plateforme.** Rendez-vous sur la page **Sync** pour intégrer les modules de la plateforme au catalogue. Cette page est une console de synchronisation en lecture seule : elle liste les modules trouvés dans le dépôt de la plateforme, et l'action **Sync Now** actualise le catalogue à partir de ce dépôt. Les modules eux-mêmes sont gérés dans le dépôt, et non modifiés sur cette page.

**Mettre à jour un module.** Modifiez le module dans le dépôt, puis lancez **Sync Now** depuis la page Sync pour actualiser sa définition (description, champs de configuration et coût en crédits) dans le catalogue.

**Retirer un module.** La gestion des modules est en lecture seule par défaut : le paramètre **Module Console Read-Only** de la page **Setup** est livré activé, ce qui masque l'action de suppression sur les cartes de module et sur la page propre d'un module, et fait rejeter par la plateforme toute suppression depuis la console. Pour retirer un module, supprimez-le de son dépôt GitHub et laissez la synchronisation suivante le retirer du catalogue. Ce n'est que si vous désactivez ce paramètre qu'une action de suppression apparaît — vous pouvez alors supprimer n'importe quel module, qu'il soit de la plateforme ou publié par un partenaire. Lorsqu'il est désactivé, l'entrée de menu **Sync** devient **Publish**.

## Setup Requests (demandes de configuration) {#setup-requests}

L'onglet **Setup Requests** de la page **Help** est l'endroit où sont traitées les demandes de configuration gérée. Examinez les demandes entrantes, attribuez un ingénieur (qui doit être un compte partenaire existant), suivez leur statut et menez-les jusqu'à leur achèvement. Lorsqu'une demande est terminée, son revenu est réparti à 75 % pour l'ingénieur et 25 % pour la plateforme, sauf si le paramètre de plateforme `platformRevenueSharePct` (audité sous le nom *Platform revenue share (setup requests)* ; il n'a pas encore de contrôle de formulaire) contient une autre valeur comprise entre 0 et 100. Finance a également accès à cet onglet ; en tant qu'administrateur, vous avez une visibilité complète sur toutes les demandes. Les utilisateurs ayant le rôle Support ne voient pas les Setup Requests — les demandes comportent des montants de revenus et de versements aux partenaires.

## Support Tickets (tickets de support) {#support-tickets}

L'onglet **Support Tickets** de la page **Help** liste les tickets ouverts via le formulaire **Help**. Triez chaque ticket : mettez à jour son statut (new, in progress, resolved, closed), ajoutez des notes et attribuez-le. Les utilisateurs ayant le rôle Support traitent également cette file ; en tant qu'administrateur, vous voyez tous les tickets. Le client suit son ticket dans son propre onglet **My Tickets**, qui affiche le statut que vous définissez, mais jamais vos notes ni la personne à qui le ticket est attribué.

## Visibilité sur les revenus, les coûts, les factures et les versements {#visibility-into-revenue-costs-invoices-and-payouts}

Vous disposez d'une visibilité financière sur l'ensemble de la plateforme :

- **Revenus** — **Module Revenue** (frais de module et parts de revenus des partenaires) et **Agent Revenue** (le relevé des commissions des agents, où une commission peut être annulée avec un motif, et les lots de versements aux agents, créés avec une date limite et marqués comme payés avec une référence de paiement ; les agents sont payés en dehors de RAD).
- **Coûts et factures** — **Project Transactions** et **Project Invoices** (coût cloud réel par projet et par mois) ; tous deux nécessitent **Enable Project Credits**. Les coûts de module par déploiement figurent dans l'onglet **Module Costs** de la page **Credits**.
- **Versements** — **Payout Summary**, les totaux par bénéficiaire pour les agents et les partenaires. **Mark paid** y enregistre le versement d'un partenaire pour une période terminée, une seule fois, au taux en vigueur ; les agents sont payés via Agent Revenue.

À l'exception de Module Costs, ces rapports sont des onglets de la page **Billing**. Deux choses à savoir avant de les chercher : votre navigation d'administrateur ne comporte pas d'entrée Billing ; attribuez-vous donc aussi le rôle Finance (qui l'ajoute) ou accédez directement à `/billing` ; et tous les onglets de Billing, sauf **Event Codes**, nécessitent **Enable Subscription** dans **Setup**, si bien que lorsqu'il est désactivé, la page s'ouvre sur Event Codes et n'affiche rien d'autre. Utilisez-les pour surveiller la santé de la plateforme, rapprocher les gains des partenaires et des agents, et examiner les dépenses des projets.

## Journal d'audit {#audit-log}

Ouvrez **Audit Log** depuis la barre de navigation pour examiner ce qui a été fait sur la plateforme. Il liste chaque action enregistrée, de la plus récente à la plus ancienne : modifications de rôles et de comptes, modifications de paramètres, attributions et ajustements de crédits, suppressions forcées, révélations d'identifiants, versements et activité des sessions de lab. Chaque ligne indique quand l'action a eu lieu, l'action elle-même et qui l'a effectuée (**System** pour les jobs planifiés).

- La page s'ouvre sur les 7 derniers jours. Modifiez les dates, choisissez une **Action** ou saisissez une partie d'adresse e-mail dans **Performed by**, puis sélectionnez **Load**. La plage peut aller jusqu'à un an.
- Sélectionnez **Show all** sur une ligne pour voir tout ce qui a été enregistré avec elle. Les valeurs secrètes ne sont jamais enregistrées ; un secret modifié apparaît masqué.
- Si une plage contient plus d'actions qu'un seul chargement ne peut en lire, seules les plus récentes sont affichées et un avis vous invite à réduire la plage de dates.

Finance dispose également d'un **Audit Log**, limité aux actions liées à l'argent. Le journal est en lecture seule : personne, administrateurs compris, ne peut modifier ou supprimer une entrée.

## Obtenir de l'aide {#getting-help}

Sur la page **Help**, votre onglet **Send Message** affiche le formulaire de message décrit ci-dessus, et non le formulaire de demande de support que voient les autres utilisateurs ; vous n'avez donc pas d'onglet My Tickets. Les onglets Setup Requests et Support Tickets se trouvent à côté. **Calculate ROI** est un onglet de la page **Credits**. Le lien **Contact Us** du pied de page mène également à Help. Pour la connexion, la navigation et les notions de base comme le déploiement de modules et les crédits, consultez [Utiliser RAD](using-rad.md).
