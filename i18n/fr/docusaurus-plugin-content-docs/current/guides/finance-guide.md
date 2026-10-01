---
title: "Guide Finance"
description: "Guide Finance de la plateforme RAD — paramètres de tarification et de crédits, attributions de crédits et codes d'événement, revenus et versements, rapprochement des coûts Google Cloud, et supervision des sessions de lab."
---
<!-- translated-from: docs/guides/finance-guide.md @ 6b90c32 -->

# Guide Finance {#finance-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Finance_Guide.png" alt="Guide Finance" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide s'adresse aux personnes ayant le rôle **Finance**, qui gèrent la configuration de la facturation de RAD, produisent les rapports de revenus et de versements, et rapprochent les coûts cloud. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

Le rôle Finance est attribué par un administrateur en plus d'un compte ordinaire ; vous conservez donc tout ce dont dispose un utilisateur inscrit. Lorsque vous vous connectez avec le rôle Finance, vous arrivez sur la page **Billing** (facturation). Votre barre de navigation affiche d'abord **Billing**, **Labs** et **Audit Log** (journal d'audit), puis les éléments courants que votre compte détient également — **Credits** (crédits), **Deployments** (déploiements) et **Solutions** pour un compte utilisateur ordinaire — et enfin **Help** (aide). (**Labs** n'apparaît que tant que les sessions de lab sont activées, et **Setup Requests** et **Support Tickets** sont des onglets de la page Help.)

## Ce que vous pouvez faire {#what-you-can-do}

- Créer et modifier les formules d'abonnement et leurs prix par prestataire (**Subscription Tiers**).
- Configurer l'économie des crédits — crédits par unité, frais, remises et parts de revenus (**Credit Settings**).
- Ajuster le solde de crédits de tout autre utilisateur (**Credit Management**).
- Émettre des **Event Codes** (codes d'événement) qui offrent des crédits gratuits aux participants à un événement.
- Produire des rapports sur le **Module Revenue** (revenus des modules), et examiner et payer les commissions des agents (**Agent Revenue**).
- Examiner les coûts des projets gérés par RAD de chaque client (**Project Transactions**) et les coûts GCP à l'échelle de l'organisation (**Project Invoices**).
- Consulter les totaux de versements par bénéficiaire (**Payout Summary**).
- Superviser les sessions de lab de tous les formateurs, et en terminer une pour arrêter ses dépenses (**Labs**).
- Voir chaque projet client de la plateforme — qui le gère, pour quel client, son statut et son portefeuille — en lecture seule, sous **Solutions → Managed Environments → Client projects → All client projects** (tant que les projets clients sont activés).
- Consulter tous les utilisateurs ainsi que les listes complètes des agents et des partenaires ; apporter des modifications limitées aux utilisateurs.
- Traiter les files de configuration gérée et de tickets de support (onglets de la page Help).
- Examiner les entrées liées à l'argent de l'**Audit Log**.

## La page Billing {#the-billing-page}

Ouvrez **Billing** depuis la barre de navigation. Elle comporte neuf onglets, dans cet ordre : **Subscription Tiers**, **Credit Settings**, **Credit Management**, **Event Codes**, **Module Revenue**, **Agent Revenue**, **Project Transactions**, **Project Invoices** et **Payout Summary**. Chacun est décrit ci-dessous.

Les onglets affichés dépendent de deux interrupteurs de la plateforme. Tous les onglets sauf **Event Codes** nécessitent l'activation de **Enable Subscription**, et **Project Transactions** et **Project Invoices** nécessitent en outre **Enable Project Credits**. La page s'ouvre toujours sur le premier onglet que vous pouvez utiliser — lorsque les abonnements sont désactivés, il s'agit d'**Event Codes**, qui est alors le seul onglet affiché.

### Subscription Tiers (paliers d'abonnement) {#subscription-tiers}

Gérez les formules de crédits récurrentes (paliers) auxquelles les utilisateurs peuvent souscrire. Chaque formule accorde un nombre défini de crédits par cycle de facturation.

1. Allez dans **Billing** > **Subscription Tiers**.
2. Cliquez pour **créer** un nouveau palier, ou sélectionnez-en un existant pour le **modifier**.
3. Définissez le nom de la formule, son prix et les crédits qu'elle accorde. Le formulaire indique ce que ce prix permettrait d'acheter au taux actuel de crédits par unité, afin que vous puissiez voir si le palier est plus avantageux qu'une simple recharge. Ensuite, dans l'onglet de chaque prestataire, collez l'identifiant du prix correspondant que vous avez **déjà créé dans le tableau de bord de ce prestataire** — **Price ID** pour Stripe, **Plan ID** pour Flutterwave. Le prix et les crédits sont communs aux deux prestataires ; seul l'identifiant diffère.
4. Enregistrez le palier. Mettez à jour ou supprimez des paliers à mesure que vos offres évoluent.

Au-dessus du tableau des paliers se trouve un panneau **Payment Providers** (prestataires de paiement). Utilisez-le pour activer ou désactiver **Stripe** et **Flutterwave** — l'onglet d'un prestataire dans le tableau des paliers reste désactivé tant que ce prestataire l'est, et aucun des deux ne peut être activé tant que Credits et Subscriptions ne sont pas tous deux activés. Le même panneau contient **Reset Subscription Credits** : laissez-le désactivé et les crédits d'abonnement non utilisés sont reportés sur le cycle de facturation suivant ; activez-le et l'allocation est remplacée à chaque renouvellement au lieu d'être ajoutée. Les crédits de recharge ne sont jamais affectés, dans un cas comme dans l'autre.

Les abonnements accordent uniquement des crédits — ils n'accordent pas le rôle Partner.

### Credit Settings (paramètres des crédits) {#credit-settings}

Configurez les paramètres globaux de l'économie des crédits.

1. Allez dans **Billing** > **Credit Settings**.
2. Définissez la valeur **credits-per-unit** (crédits par unité : la correspondance entre crédits et devise).
3. Définissez les **parts de revenus** — le pourcentage des revenus attribué aux **agents** parrains (Agent Revenue Share) et aux **partenaires** auteurs de modules (Partner Revenue Share).
4. Définissez le reste de l'économie depuis le même onglet. Chaque paramètre est un petit formulaire distinct doté de son propre bouton Save, ce qui vous permet d'en modifier un sans toucher aux autres : les attributions de crédits gratuits (Signup, Monthly, Referral et la limite de parrainage), le **Minimum Top-up** (le plus petit achat ponctuel en dollars américains : $10 par défaut, entre $1 et $1 000), le seuil de crédits faibles, les crédits par heure, les quatre frais de module (CR et GKE, frais et frais de configuration), la RAD-Managed Module Discount, la réserve de crédits de déploiement, les seuils d'admission Sandbox/Development/Production/Lab et les budgets mensuels des projets, la marge de crédits des projets, l'intervalle d'actualisation des déploiements, et les valeurs de départ du calculateur de ROI. La limite de parrainage (**Referral Rewards**) accepte trois types de valeurs : **-1** signifie illimité, **0** désactive le programme de parrainage (aucun crédit de parrainage, et la section **Refer and earn** disparaît de Profile, ainsi que son raccourci dans Credits), et un nombre positif correspond au nombre mensuel de parrainages pour lesquels chaque parrain gagne des crédits. Les agents sont exemptés de ce plafond mensuel. Les **remises groupées sur les solutions** n'ont pas de contrôle dans cet onglet : les frais de module d'une solution bénéficient d'une remise de 15 % pour trois ou quatre membres, de 20 % pour cinq ou six et de 25 % pour sept ou plus ; modifier ces paliers relève d'une modification des paramètres par un administrateur (`solutionBundleDiscountTiers`), et non d'un formulaire de cet onglet.
5. Décidez ce qui est facturé pour un **déploiement en échec**, sur la carte **Failed Deployments**. Elle comporte deux interrupteurs indépendants, et chaque libellé indique son propre résultat (« Build cost charged » / « Build cost not charged », « Module fee charged » / « Module fee not charged ») :
   - **Build cost** (coût de build) — indique si le temps Cloud Build décompté d'un nouveau déploiement qui échoue ou est annulé est facturé.
   - **Module fee** (frais de module) — indique si les frais de module sont facturés pour ce déploiement alors qu'il n'a jamais abouti.

   **Dans la version actuelle, les deux sont désactivés : aucun déploiement en échec n'est facturé.** Activer l'un ou l'autre s'applique aux déploiements qui échouent à partir de ce moment ; cela ne refacture jamais les échecs passés. Ces interrupteurs ne couvrent que l'échec de la *création* d'un déploiement — les mises à jour et destructions en échec ne sont pas facturées, et les déploiements de lab sont facturés via la session du formateur. Quel que soit votre choix, les frais d'échec sont plafonnés par utilisateur (par défaut à trois échecs facturés sur 24 heures), de sorte qu'un module qui échoue sans cesse ne peut pas épuiser le solde d'un client. Un déploiement **réussi** est toujours facturé intégralement, quel que soit le réglage de ces interrupteurs.

Cet onglet contient également **Adjust All Credits**, qui applique le montant saisi au solde de **tous** les utilisateurs à la fois — positif pour accorder, négatif pour déduire. Cochez **Free** pour modifier les crédits offerts, ou laissez la case décochée pour modifier les crédits achetés. Les ajustements importants ne peuvent être soumis qu'une fois un motif indiqué et la phrase de confirmation affichée saisie. Utilisez plutôt Credit Management ci-dessous pour modifier une seule personne.

Remarque : les interrupteurs de la plateforme — **Enable Credits**, **Enable Subscription** et **Enable Project Credits** — se trouvent sur la page **Setup** de l'administrateur, que Finance ne peut pas ouvrir. **Enable Subscription** est l'interrupteur de tout achat : lorsqu'il est désactivé, il n'y a ni nouveaux abonnements ni recharges ponctuelles chez l'un ou l'autre prestataire, les options d'achat et d'abonnement disparaissent, et les abonnés existants peuvent toujours annuler leur abonnement depuis la page Credits. En tant que Finance, vous voyez et configurez l'interface de facturation, mais vous n'activez ni ne désactivez ces interrupteurs depuis celle-ci.

### Credit Management (gestion des crédits) {#credit-management}

Ajustez les soldes de crédits d'un utilisateur individuel.

1. Allez dans **Billing** > **Credit Management**.
2. Recherchez l'utilisateur par son adresse e-mail.
3. Cliquez sur **Edit** et définissez les soldes. Il y en a trois, et ils se comportent différemment : les **Awards** sont des crédits gratuits réinitialisés chaque mois, les crédits **Subscription** proviennent d'une formule et sont remplacés au renouvellement lorsque la réinitialisation est activée, et les crédits **Top-up** ont été achetés directement et n'expirent jamais. Les dépenses puisent d'abord dans les crédits offerts, puis dans les crédits d'événement (obtenus avec un code d'événement, voir ci-dessous, et non modifiables ici), puis dans l'abonnement, puis dans la recharge. **Monthly Partner** n'est pas un solde utilisable — il s'agit de l'allocation récurrente ajoutée chaque mois aux Awards d'un partenaire.
4. Enregistrez la modification.

Deux choses à prévoir. Vous ne pouvez pas ajuster votre **propre** solde : l'enregistrement est rejeté et il vous est demandé de vous adresser à un autre utilisateur Finance ou administrateur, ce qui garantit deux identités sur chaque attribution. Et si quelqu'un d'autre a modifié le solde de cet utilisateur pendant que votre formulaire de modification était ouvert, votre enregistrement est rejeté, le formulaire se ferme et le tableau s'actualise — rouvrez-le et effectuez la modification à partir du montant actuel.

Seuls les soldes que vous modifiez réellement sont enregistrés ; les autres restent exactement tels quels, y compris un solde négatif ou fractionnaire. Le formulaire de modification ne comporte pas de contrôle **Is Partner?** pour vous : le statut de partenaire est un rôle, et seuls les administrateurs modifient les rôles.

### Event Codes (codes d'événement) {#event-codes}

Offrez aux participants d'un événement partenaire (un DevFest, un atelier) des crédits gratuits qu'ils obtiennent eux-mêmes en saisissant un code.

1. Allez dans **Billing** > **Event Codes** et cliquez sur **New event code**.
2. Saisissez un code ou cliquez sur **Generate**, et nommez l'**Event**.
3. Définissez **Credits per claim** et **Maximum claims**. Le formulaire indique le maximum que le code peut distribuer (crédits × utilisations) avant que vous ne le créiez.
4. Définissez **Claim until** (et éventuellement **Claim from**), ainsi que la date d'expiration des crédits — soit un nombre de **jours après l'utilisation**, soit une **date d'expiration fixe**.
5. Restreignez-le éventuellement à des **domaines d'e-mail** ou à une liste de **participants** (une adresse e-mail par ligne), puis cliquez sur **Create code**.

Chaque compte peut utiliser un code une seule fois, et uniquement avec une adresse e-mail vérifiée. Les crédits sont versés sur le solde **Event credits** de l'utilisateur : ils sont gratuits (jamais comptés comme achetés), sont dépensés après les crédits offerts mensuels, ne paient pas l'utilisation de Google Cloud dans un projet géré par RAD, et expirent à leur propre date plutôt qu'avec la réinitialisation mensuelle. Une fois un code créé, ses crédits et sa validité sont figés ; vous pouvez toujours le **Disable** ou l'**Enable**, déplacer sa date de clôture ou modifier son plafond. **Details** liste les personnes qui l'ont utilisé, et **Export claims (CSV)** télécharge cette liste.

**Vous ne pouvez pas utiliser vous-même de codes d'événement.** Les comptes Finance et administrateur — les comptes qui créent les codes — sont refusés, et personne ne peut utiliser un code qu'il a créé, même après avoir perdu le rôle. C'est la même règle que celle qui vous empêche d'ajuster votre propre solde. Le champ de code d'événement de la page Credits (la ligne **Claim credits**) ne vous est pas affiché pour cette raison ; tant que le programme de parrainage est actif, vous y voyez à la place un lien **Get your referral link**.

### Module Revenue (revenus des modules) {#module-revenue}

Consultez les revenus générés par les déploiements, ainsi que la part attribuée à chaque partenaire ou agent.

1. Allez dans **Billing** > **Module Revenue**. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour changer de période, choisissez une date de début et une date de fin — la plage ne peut pas dépasser 366 jours — et cliquez sur **Refresh**.
3. Sans partenaire ni agent sélectionné, vous consultez l'ensemble des revenus de la plateforme pour cette période. Sélectionnez un ou plusieurs partenaires (ou agents) pour restreindre l'affichage à leur part de revenus, calculée à partir du pourcentage défini dans Credit Settings. Vous pouvez aussi filtrer par module.
4. Chaque ligne indique la date, le nom du module, l'adresse e-mail de l'utilisateur, le coût en crédits et le revenu. **Export to CSV** exporte l'ensemble filtré complet, et pas seulement la page affichée.

### Agent Revenue (revenus des agents) {#agent-revenue}

Les commissions des agents et les versements qui les règlent. Un agent perçoit une part (l'**Agent Revenue Share** définie dans Credit Settings) des **frais de module** que ses utilisateurs parrainés paient avec des crédits **achetés**. Elle est calculée en dollars américains et versée en argent, en dehors de RAD. Les frais de build, l'utilisation des projets, les crédits offerts ou promotionnels, le supplément de projet en libre-service et tout ce qui est dépensé dans un lab ne rapportent jamais de commission. Le [Guide de l'agent](agent-guide.md#how-commission-works) présente les règles complètes.

L'onglet comporte deux parties.

**Le relevé des commissions.**

1. Allez dans **Billing** > **Agent Revenue** et choisissez un agent — actuel ou ancien, car un agent rétrogradé peut encore se voir devoir des commissions. Vous voyez son relevé exactement comme il le voit : les totaux (Earned, Reversed, On hold, Payable, In payout, Paid) et une ligne par commission.
2. Chaque commission est **en attente pendant 30 jours** avant de devenir payable, afin que des frais remboursés ou contestés puissent d'abord être traités.
3. Pour reprendre une commission, par exemple parce que les frais correspondants ont été remboursés, utilisez **Reverse** sur sa ligne et indiquez un motif. L'annulation est enregistrée comme une nouvelle entrée négative, jamais comme une modification. Si la commission n'a pas encore été payée, la paire s'annule — et si elle figure dans un lot de versement qui n'est pas encore marqué comme payé, le total de ce lot diminue du même montant. Si elle a été payée, le montant est déduit du prochain versement de cet agent. Le motif est affiché à l'agent et inscrit dans le journal d'audit.

**Les versements aux agents.**

1. Choisissez une **Cut-off date** (date limite) et cliquez sur **Create payout batch**. Le lot reprend toutes les commissions payables à la date limite et déduit les éventuelles annulations.
2. Les agents à qui l'on doit moins que le **minimum de $50** sont reportés sur un lot ultérieur ; rien n'est perdu.
3. **Un agent désactivé est exclu.** Sa commission reste enregistrée et en attente, et n'est versée dans un lot ultérieur que si le compte est réactivé. Un compte désactivé ne perçoit pas non plus de nouvelle commission.
4. Payez chaque agent en dehors de RAD, puis saisissez la **Payment reference** (référence de paiement) et marquez le lot comme payé. Le relevé de l'agent affiche alors ces commissions comme **Paid**.

La création d'un lot, son marquage comme payé et l'annulation d'une commission génèrent chacun une entrée dans le journal d'audit.

### Project Transactions (transactions des projets) {#project-transactions}

Les coûts des projets Google Cloud gérés par RAD de chaque client, tels qu'ils ont été facturés.

1. Allez dans **Billing** > **Project Transactions**. L'onglet s'ouvre sur les 7 derniers jours.
2. Recherchez par ID de projet ou par adresse e-mail du propriétaire, ajustez les dates et cliquez sur **Search**.
3. Chaque ligne indique le projet, son propriétaire et les crédits facturés. Toutes les pages de résultats sont chargées, de sorte que les totaux et les exports couvrent l'ensemble de la période.

### Project Invoices (factures des projets) {#project-invoices}

Rapprochez les dépenses Google Cloud réelles.

1. Allez dans **Billing** > **Project Invoices**. L'onglet s'ouvre sur le mois en cours et le charge.
2. Choisissez un autre mois pour le changer ; **Fetch Project Invoice** recharge les données.
3. Chaque ligne indique le nom et l'ID du projet, son propriétaire, le **coût catalogue en crédits** (le coût au taux de crédits par unité, avant toute marge de projet — ce n'est donc pas le montant débité) et le coût total dans votre devise d'affichage. Les totaux sous le tableau couvrent la page affichée, ce qui est indiqué. **Export to CSV** exporte tous les projets de ce mois.

Les **Module Costs** par déploiement ne sont pas un onglet de Billing — ils se trouvent sur la page **Credits**.

### Payout Summary (récapitulatif des versements) {#payout-summary}

Consultez les totaux de versements par bénéficiaire, partenaires et agents confondus. Cet onglet est réservé à **Finance et aux administrateurs**.

1. Allez dans **Billing** > **Payout Summary**. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour établir un rapport sur une autre période, choisissez une date de début et une date de fin — toutes deux obligatoires, 366 jours maximum — puis cliquez sur **Calculate Payouts**.
3. Chaque ligne indique l'adresse e-mail du bénéficiaire, s'il est payé en tant qu'Agent, Partner ou les deux, le nombre de transactions, les crédits achetés correspondants, le **Setup Revenue** qu'un partenaire a perçu en tant qu'ingénieur sur des demandes de configuration terminées, et l'Amount Due (montant dû) dans votre devise de facturation. Les montants des agents proviennent du registre des commissions, et le total de la base de commission compte chaque dépense une seule fois, même lorsqu'elle a rémunéré à la fois un agent et un partenaire. Les totaux de la période apparaissent sous le tableau, et **Export to CSV** vous fournit la même liste pour travailler.

#### Enregistrer un versement à un partenaire {#recording-a-partner-payout}

RAD n'envoie pas d'argent — vous payez les partenaires en dehors de la plateforme —, mais une fois le paiement effectué, enregistrez-le afin que vous et le partenaire en conserviez une trace durable.

1. Sélectionnez la période couverte par le paiement. **La période doit être terminée** : **Mark paid** reste désactivé tant que la période inclut la date du jour, car tout ce qui serait gagné après l'enregistrement ne pourrait jamais être payé.
2. Sur la ligne du partenaire, saisissez éventuellement votre référence de paiement, puis cliquez sur **Mark paid**.
3. RAD recalcule le montant du partenaire pour cette période et **l'enregistre avec les taux en vigueur à ce moment-là**. Ce montant enregistré constitue la trace définitive : si le taux de partage des revenus change par la suite, le montant affiché en direct sur cette page évolue, mais le paiement enregistré ne change pas, et la ligne affiche les deux lorsqu'ils diffèrent.

Une période ne peut être enregistrée qu'une fois par partenaire ; marquer à nouveau la même période ne change rien, et une période qui chevauche une période déjà enregistrée pour ce partenaire est refusée. Chaque versement enregistré génère une entrée d'audit, et le partenaire le voit dans la section **Payouts** de son onglet **Module Revenue**. Les commissions des agents disposent de leur propre circuit de versement dans **Agent Revenue**.

## Consulter les utilisateurs, les agents et les partenaires {#viewing-users-agents-and-partners}

En tant que Finance, vous pouvez voir tous les utilisateurs ainsi que les listes complètes des agents et des partenaires.

- Consultez et recherchez tous les comptes dans **Billing** > **Credit Management** — le tableau liste tous les utilisateurs et comporte un champ « Search by email ». Il n'y a pas de page Users séparée pour Finance ; celle-ci est réservée aux administrateurs.
- Consultez les partenaires et les agents de la plateforme via les sélecteurs de **Module Revenue**, d'**Agent Revenue** et le champ Assigned Engineer des Setup Requests.

### Modifications limitées des utilisateurs {#limited-user-edits}

La seule modification que vous pouvez apporter à un compte utilisateur concerne ses **soldes de crédits** (Awards, Subscription, Top-up et l'allocation Monthly Partner), et jamais sur votre propre compte.

Tous les **rôles** — y compris l'attribution ou le retrait du rôle **Partner** — et le statut **actif** d'un utilisateur sont **réservés aux administrateurs** ; l'écran Credit Management ne vous présente donc aucun contrôle de rôle. Vous pouvez toutefois définir l'allocation **Monthly Partner** d'une personne qui détient déjà le rôle Partner.

## Labs {#labs}

Finance supervise les sessions de lab ; elle ne les anime pas.

1. Cliquez sur **Labs** dans la barre de navigation (la même vue se trouve sous **Solutions → Managed Environments**). Vous voyez les sessions de tous les formateurs, avec une plage de dates, un filtre de statut et une colonne **Trainer**.
2. Ouvrez **Participants** sur une session pour voir son règlement — engagé, consommé, remboursable, et tout montant absorbé par RAD — ainsi que ses participants. **Export CSV** télécharge la liste.
3. L'environnement de chaque participant ouvre une page de déploiement en lecture seule : statut du build et journaux, avec les secrets masqués. L'onglet **Outputs** et les mots de passe ou clés générés ne vous sont pas affichés ; ils appartiennent au participant et au formateur.

La seule modification que vous pouvez effectuer est **End now**, qui arrête immédiatement les dépenses d'une session. Elle ne déplace aucun argent : le séquestre est soldé plus tard, une fois l'utilisation Google Cloud de la session décomptée. Tout le reste — créer ou dupliquer des sessions, démarrer des chronomètres, prolonger, ajouter ou retirer des participants, renvoyer des invitations, provisionner et recharger — relève du formateur de la session ou d'un administrateur, et ces contrôles ne vous sont pas affichés.

## Setup Requests (demandes de configuration) {#setup-requests}

Les demandes de configuration gérée émanant d'utilisateurs qui souhaitent que RAD prenne en charge un déploiement pour eux apparaissent ici.

1. Cliquez sur **Help** dans la barre de navigation, puis ouvrez l'onglet **Setup Requests**.
2. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement. Pour modifier l'affichage, choisissez un filtre de statut ainsi qu'une date de début et de fin, puis cliquez sur **Load Requests**.
3. Développez une demande pour la traiter : définissez son **statut** (new, in-progress, completed ou cancelled), choisissez un **Assigned Engineer** (ingénieur attribué ; seuls les partenaires inscrits sont acceptés), saisissez le **Revenue Achieved** (revenu réalisé) et ajoutez des notes internes. Cliquez sur **Save** pour appliquer.
4. C'est l'enregistrement d'une demande comme *completed* qui calcule la répartition entre le revenu de la plateforme et celui de l'ingénieur ; renseignez donc le montant du revenu avant de la marquer comme terminée. L'ingénieur conserve **75 %** et la plateforme **25 %** par défaut ; un administrateur peut définir une autre part pour la plateforme (**Platform revenue share (setup requests)** dans les paramètres), et une part de 0 est respectée. La **Partner Revenue Share** des modules n'affecte pas les demandes de configuration. Modifier le revenu d'une demande déjà terminée recalcule la répartition sans changer sa date d'achèvement. **Export to CSV** vous fournit l'ensemble chargé pour vos rapports.

## Journal d'audit {#audit-log}

Ouvrez **Audit Log** depuis la barre de navigation pour voir qui a modifié quoi, et quand, concernant l'argent de la plateforme. Votre vue n'affiche que les actions liées à l'argent : modifications de soldes de crédits et ajustements groupés, récompenses de parrainage, annulations de commissions d'agents et versements, répartitions de revenus des demandes de configuration, codes d'événement, ainsi que prélèvements, remboursements et règlements des sessions de lab — y compris une place qu'un formateur a payée pour le compte d'un participant (avec la note du formateur sur le paiement hors ligne, s'il en a laissé une). Les administrateurs voient toutes les actions.

- La page s'ouvre sur les 7 derniers jours. Modifiez les dates, choisissez une **Action** ou saisissez une partie d'adresse e-mail dans **Performed by**, puis sélectionnez **Load**. La plage peut aller jusqu'à un an.
- Sélectionnez **Show all** sur une ligne pour voir tout ce qui a été enregistré avec elle, comme le solde avant et après une modification.
- Si une plage contient plus d'actions qu'un seul chargement ne peut en lire, seules les plus récentes sont affichées et un avis vous invite à réduire la plage de dates.

Le journal est en lecture seule.

## Obtenir de l'aide {#getting-help}

Cliquez sur **Help** dans la barre de navigation :

- Onglet **Send Message** — un formulaire de contact qui ouvre un ticket de support et envoie un e-mail à l'équipe de support. L'onglet **My Tickets** à côté liste les tickets que vous avez ouverts et leur statut. Tant que les achats sont activés, l'ouverture d'un ticket nécessite des crédits achetés sur votre compte ; lorsque les achats sont désactivés, tout le monde peut en ouvrir un. Chaque compte peut ouvrir jusqu'à 5 tickets sur 24 heures.
- Onglet **Setup Requests** — décrit ci-dessus.
- Onglet **Support Tickets** — la file de tickets partagée. La facturation étant l'une de ses catégories, vous pouvez en assurer le tri : Finance et les administrateurs peuvent attribuer, réattribuer ou retirer la personne attribuée à un ticket au profit de n'importe qui, tandis que les agents de support peuvent uniquement prendre en charge un ticket non attribué ou libérer un ticket qu'ils détiennent.

Le calculateur de **ROI** ne se trouve pas dans Help — c'est le dernier onglet de la page **Credits**, **Calculate ROI**. Credits n'apparaît dans votre navigation que si votre compte détient aussi le rôle utilisateur ordinaire ; sinon, accédez directement à `/credits`. Sans le rôle utilisateur, vous n'avez pas de registre de crédits propre ; la page ne propose donc pas **Credit Transactions** et s'ouvre sur **Module Revenue** ; **Module Costs** et **Project Invoices** y figurent comme d'habitude.

Un lien **Contact Us** dans le pied de page vous mène également à la page Help.
