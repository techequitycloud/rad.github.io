---
title: "Guide Finance"
description: "Guide financier de la plateforme RAD — tarifs et paramètres de crédits, attributions de crédits et codes d'événement, revenus et règlements, rapprochement des coûts Google Cloud et supervision des sessions de lab."
---

<!-- translated-from: docs/guides/finance-guide.md @ 2be24ed1 sha256:0a92f34547da -->

# Guide Finance {#finance-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Finance_Guide.png" alt="Guide Finance" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide est destiné aux personnes disposant du rôle **Finance**, qui gèrent la configuration de la facturation de RAD, génèrent les rapports de revenus et de règlements et effectuent le rapprochement des coûts cloud. Vous découvrez RAD ? Commencez par [Utiliser RAD](using-rad.md).

Le rôle Finance est attribué par un administrateur en complément d'un compte ordinaire ; vous conservez donc tout ce dont dispose un utilisateur inscrit. Lorsque vous vous connectez avec le rôle Finance, vous arrivez sur la page **Billing**. Votre barre de navigation affiche d'abord **Billing**, **Labs** et **Audit Log**, puis les rubriques habituelles associées à votre compte — **Credits**, **Deployments** et **Solutions** pour un compte utilisateur standard — et enfin **Pricing** et **Help**. (**Labs** n'apparaît que lorsque les sessions de lab sont activées, et **Setup Requests** ainsi que **Support Tickets** sont des onglets situés dans la page Help.)

## Ce que vous pouvez faire {#what-you-can-do}

- Créer et modifier les formules d'abonnement et leurs prix par fournisseur (**Subscription Tiers**).
- Configurer l'économie des crédits — ratio crédits par unité, frais, remises et partages de revenus (**Credit Settings**).
- Ajuster le solde de crédits de n'importe quel autre utilisateur (**Credit Management**).
- Émettre des **Event Codes** qui offrent des crédits gratuits aux participants d'un événement.
- Approuver ou rejeter les demandes des clients visant à faire payer par RAD leurs propres projets Google Cloud (**Linked Projects**), définir le taux de TVA de chaque client, ses informations fiscales et son sous-compte de facturation (**Customer Billing**), et générer le rapport sur la TVA collectée (**VAT Report**).
- Créditer les paiements prélevés par le fournisseur mais que RAD n'a jamais crédités (**Missing Payments**).
- Générer des rapports sur les revenus des modules (**Module Revenue**), puis vérifier et verser les commissions des agents (**Agent Revenue**).
- Examiner les coûts des projets gérés par RAD pour chaque client (**Project Transactions**) et les coûts GCP à l'échelle de l'organisation (**Project Invoices**).
- Consulter les totaux des règlements par bénéficiaire (**Payout Summary**).
- Superviser les sessions de lab de chaque formateur, et en interrompre une pour stopper ses dépenses (**Labs**).
- Visualiser chaque projet client sur la plateforme — qui l'exécute, pour quel client, son statut et son portefeuille — en lecture seule, sous **Solutions → Managed Environments → Client projects → All client projects** (lorsque les projets clients sont activés).
- Consulter l'ensemble des utilisateurs ainsi que les listes complètes des agents et partenaires ; apporter des modifications limitées aux utilisateurs.
- Traiter les files d'attente des demandes de configuration gérée et des tickets de support (onglets sur la page Help).
- Examiner les entrées financières du journal d'audit (**Audit Log**).

## La page Billing {#the-billing-page}

Ouvrez **Billing** depuis la barre de navigation. Elle comporte treize onglets, dans cet ordre : **Subscription Tiers**, **Credit Settings**, **Credit Management**, **Event Codes**, **Linked Projects**, **Customer Billing**, **VAT Report**, **Missing Payments**, **Module Revenue**, **Agent Revenue**, **Project Transactions**, **Project Invoices** et **Payout Summary**. Chacun est décrit ci-dessous.

Les onglets affichés dépendent de deux interrupteurs généraux de la plateforme. **Event Codes**, **Linked Projects**, **Customer Billing**, **VAT Report** et **Missing Payments** apparaissent toujours ; tous les autres onglets nécessitent que **Enable Subscription** soit activé, et **Project Transactions** ainsi que **Project Invoices** requièrent également l'activation de **Enable Project Credits**. La page s'ouvre toujours sur le premier onglet que vous pouvez utiliser — avec les abonnements désactivés, il s'agit de **Event Codes**. **Linked Projects**, **Customer Billing**, **VAT Report** et **Missing Payments** sont réservés au rôle Finance : les administrateurs ne les voient pas.

### Subscription Tiers {#subscription-tiers}

Gérez les formules (paliers) de crédits récurrents auxquelles les utilisateurs peuvent s'abonner. Chaque formule attribue un nombre défini de crédits par cycle de facturation.

1. Allez dans **Billing** > **Subscription Tiers**.
2. Cliquez pour **créer** un nouveau palier, ou sélectionnez-en un existant pour le **modifier**.
3. Définissez le nom de la formule, son prix et les crédits qu'elle attribue. Le formulaire indique ce que ce prix permettrait d'obtenir au ratio actuel de crédits par unité, afin que vous puissiez voir si le palier est plus avantageux qu'une simple recharge. Ensuite, sur l'onglet de chaque fournisseur, collez l'identifiant du tarif correspondant que vous avez **déjà créé dans le tableau de bord propre à ce fournisseur** — **Price ID** pour Stripe, **Plan ID** pour Flutterwave. Le prix et les crédits sont partagés par les deux fournisseurs ; seul l'identifiant diffère.
4. Enregistrez le palier. Mettez à jour ou supprimez les paliers au gré de l'évolution de vos offres.

Au-dessus du tableau des paliers se trouve un panneau **Payment Providers**. Utilisez-le pour activer ou désactiver **Stripe** et **Flutterwave** — l'onglet d'un fournisseur dans le tableau des paliers reste désactivé tant que ce fournisseur est désactivé, et aucun ne peut être activé tant que Credits et Subscriptions ne sont pas tous deux actifs. **Flutterwave Subscriptions** (utilisable uniquement lorsque Flutterwave est actif) détermine si de nouveaux abonnements peuvent être souscrits avec Flutterwave ; lorsqu'il est désactivé, Flutterwave accepte uniquement les recharges de crédits et les abonnés Flutterwave existants ne sont pas impactés. Le même panneau contient **Reset Subscription Credits** : laissez-le désactivé pour que les crédits d'abonnement non utilisés soient reportés sur le cycle de facturation suivant ; activez-le pour que le forfait soit remplacé à chaque renouvellement au lieu d'y être ajouté. Les crédits achetés via des recharges ne sont jamais affectés dans un cas comme dans l'autre.

Les abonnements n'attribuent que des crédits — ils ne confèrent pas le rôle Partner.

### Credit Settings {#credit-settings}

Configurez les paramètres globaux de l'économie des crédits.

1. Allez dans **Billing** > **Credit Settings**.
2. Définissez la valeur des **crédits par unité** (la conversion des crédits en devise).
3. Définissez les **partages de revenus** — le pourcentage de revenus alloué aux **agents** référents (Agent Revenue Share) et aux **partenaires** concepteurs de modules (Partner Revenue Share).
4. Configurez le reste de l'économie depuis ce même onglet. Chaque paramètre dispose de son propre mini-formulaire avec son propre bouton Save, ce qui permet d'en modifier un sans toucher aux autres : les dotations en crédits gratuits (Signup, Monthly, Referral et la limite de parrainage ; un bonus de parrainage est versé, et décompté du plafond mensuel, dès lors que le filleul effectue son premier déploiement ou mise à jour réussi d'un module d'application, ou achète des crédits, dans les 90 jours suivant son inscription, les agents étant exemptés de ce plafond), le **Minimum Top-up** (le plus petit achat ponctuel en dollars américains : 10 $ par défaut, compris entre 1 $ et 1 000 $), le déclencheur de solde bas, les crédits par heure (utilisés uniquement pour les sessions de lab, les projets clients, les builds en échec au-delà du quota quotidien ci-dessous, et lorsque la facturation des builds à la minute est cochée), la taille du **pack de démarrage** (150 crédits par défaut, soit 15 $ à raison de 10 crédits pour un dollar : le premier achat proposé aux utilisateurs, dimensionné pour franchir le plancher de 100 crédits de la sandbox avec une marge de fonctionnement ; il n'est proposé que si son achat permet de dépasser le plancher du palier vers lequel l'utilisateur déploie, sinon l'utilisateur voit son déficit réel), l'interrupteur **Monthly Credits Only for Active Users** et sa fenêtre d'activité **Monthly Credits Activity Window** (activé, 30 jours : l'attribution mensuelle ne va qu'aux utilisateurs ayant un build réussi (un déploiement, une mise à jour ou une suppression) ou un achat au cours de cette période), l'avertissement d'expiration **Monthly Credits Lapse Warning** (activé par défaut : au cours des 5 derniers jours du mois, les utilisateurs qui risquent de perdre leurs crédits mensuels reçoivent un e-mail leur indiquant qu'un build réussi ou un achat avant le 1er permet de les conserver), les quatre frais de module (CR et GKE, frais standard et frais de configuration), la remise pour module géré par RAD, la réserve de crédits pour déploiement, les planchers d'admission et budgets mensuels des projets Sandbox/Development/Production/Lab, la marge sur les crédits de projet, les trois paramètres des projets associés (**Linked Project Margin**, 10 % par défaut et compris entre 0 % et 100 %, ajoutée au tarif public de Google pour le projet associé propre au client ; **Linked Project Floor**, 2 500 crédits par défaut ; et **Linked Project Floor (days of spend)**, 7 par défaut — un client associé doit détenir le montant le plus élevé entre le plancher fixe et ce nombre de jours de ses dépenses récentes), l'intervalle d'actualisation des déploiements, l'alerte de rapprochement de facturation **Billing Reconciliation Alert** (en dollars américains, 1 par défaut, jusqu'à 10 000 : RAD alerte ses administrateurs lorsque des coûts Google Cloud supérieurs à ce montant sur une période de facturation n'ont pu être attribués à personne), et les valeurs initiales du calculateur de ROI. La limite de parrainage (**Referral Rewards**) accepte trois types de valeurs : **-1** signifie illimité, **0** désactive le programme de parrainage (aucun crédit de parrainage, et la section **Refer and earn** disparaît du Profile ainsi que son raccourci dans Credits), et un nombre positif correspond au nombre mensuel de filleuls pour lesquels chaque parrain gagne des crédits. Les agents sont exemptés de ce plafond mensuel. Les **remises pour pack de solutions** ne disposent d'aucun contrôle sur cet onglet : les frais de module d'une solution bénéficient d'une remise de 15 % pour trois ou quatre membres, 20 % pour cinq ou six et 25 % pour sept ou plus (si le client annule des membres avant leur build, les membres restants à facturer sont recalculés avec la remise du pack réduit), et la modification de ces paliers relève d'un changement de paramètres administrateur (`solutionBundleDiscountTiers`), et non d'un formulaire sur cette page.
5. Définissez le mode de facturation des builds pour les déploiements, sur les cartes **Build pricing** à côté de Credits per Hour :
   - **Charge build time per minute** — décoché par défaut, ce qui signifie que **les builds sont inclus dans le prix** : un déploiement ne paie que ses frais de module ; les mises à jour sont gratuites jusqu'à concurrence de **Updates Included per Month** (5) pour chaque déploiement, puis facturées au montant de **Price of Each Further Update** (2 crédits) ; les destructions, purges et builds en échec sont gratuits, sous réserve de la limite de builds en échec ci-dessous ; Project_GCP et Services_GCP sont inclus lorsqu'ils sous-tendent une application, et coûtent **Project_GCP on Its Own** (10) et **Services_GCP on Its Own** (20) lorsqu'ils sont déployés seuls. Cocher cette option réactive la facturation à la minute au tarif de Credits per Hour.
   - **Builds One User May Run at Once** — 3 par défaut (1 à 100). Un déploiement ou une mise à jour supplémentaire est refusé tant que l'un des builds de cet utilisateur n'est pas terminé ; une suppression ou une purge n'est jamais refusée, et les applications d'une même solution ne se bloquent jamais entre elles. Les administrateurs et le provisionnement des labs sont exemptés.
   - **Free Failed Builds per User per Day** — 10 par défaut (0 à 1 000), décomptés par jour UTC. Au-delà, un utilisateur qui détient des crédits achetés est facturé à la minute (au tarif de Credits per Hour) pour chaque nouveau déploiement ou mise à jour en échec, et un utilisateur qui n'en possède aucun se voit refuser de nouveaux builds jusqu'au jour UTC suivant. Les échecs imputables à RAD ou Google, ainsi que les destructions en échec, ne sont jamais comptabilisés. Les destructions et purges sont toujours autorisées.
   - **Free Build Minutes per Day (No Purchased Credits)** — 120 par défaut (0 à 10 000), décomptées par jour UTC sur l'ensemble des builds d'un utilisateur ne détenant aucun crédit acheté, qu'ils soient réussis ou non. Au-delà, les nouveaux déploiements et mises à jour de cet utilisateur sont mis en attente jusqu'au jour UTC suivant, ou jusqu'à ce qu'il achète des crédits ; les destructions et les purges sont toujours autorisées. Cela limite ce qu'un compte gratuit peut coûter à RAD en temps de build. Les administrateurs et le provisionnement des labs sont exemptés.
   - **Désactiver une limite.** Définissez **Free Build Minutes per Day** sur **0** pour désactiver cette allocation. Les deux autres n'ont pas d'interrupteur d'arrêt : définissez-les plutôt sur leur valeur maximale (0 build en échec gratuit ne désactive pas cette limite — cela signifie qu'aucun build en échec n'est gratuit).
   - **First deployment free** — activé par défaut : le premier déploiement réussi d'un module par chaque utilisateur est exempté de ses frais de module, quel que soit l'éditeur du module, une seule fois par utilisateur. **First Deployment Free: Fee Cap (0 = No Cap)** permet de limiter l'offre aux modules dont les frais ne dépassent pas le plafond ; il est à 0 (aucun plafond) par défaut. Cela s'applique à un module d'application financé par les crédits propres de l'utilisateur (dans une solution, le premier membre à réussir son déploiement), jamais à une session de lab ou à un projet client. Project_GCP et Services_GCP déployés seuls ne sont jamais gratuits : ils sont facturés à leur tarif forfaitaire (10 et 20 crédits par défaut) et ne consomment pas l'offre.

   Les sessions de lab et les portefeuilles de projets clients restent facturés pour le temps de build à la minute au tarif de Credits per Hour.
   - Modifier **Charge build time per minute** modifie une condition tarifaire publique ; le formulaire vous demande donc de confirmer (**Confirm**) avant d'enregistrer. Mettez à jour la page des tarifs, les conditions générales et les guides en conséquence.
6. Choisissez comment un **déploiement en échec** est facturé, sur la carte **Failed Deployments**. Elle comporte deux options indépendantes, et chaque libellé indique son propre résultat ("Build cost charged" / "Build cost not charged", "Module fee charged" / "Module fee not charged") :
   - **Build cost** — indique si le temps mesuré de Cloud Build d'un nouveau déploiement qui échoue ou est annulé doit être facturé. Cela n'intervient que lorsque la facturation des builds à la minute est cochée (et pour les portefeuilles de labs et de projets clients) ; lorsque les builds sont inclus, un build en échec est gratuit jusqu'à concurrence de **Free Failed Builds per User per Day** ; au-delà, un nouveau déploiement ou une mise à jour qui échoue est facturé à la minute pour un utilisateur disposant de crédits achetés, quelle que soit la position de cet interrupteur.
   - **Module fee** — indique si les frais de module sont facturés pour ce déploiement bien qu'il n'ait jamais abouti.

   **Dans la version actuelle, les deux sont désactivés : dans la limite de l'allocation quotidienne de builds en échec gratuits, aucun déploiement en échec n'est facturé.** En activer un s'applique aux déploiements qui échouent à partir de cet instant ; cela ne refacture jamais les échecs passés. Ces options ne couvrent que l'échec de la *création* d'un déploiement. Une mise à jour en échec n'est facturée qu'au-delà de **Free Failed Builds per User per Day** (à la minute, à un utilisateur disposant de crédits achetés), quel que soit leur réglage ; les destructions en échec ne sont jamais facturées, et les déploiements de lab sont facturés via la session du formateur. Quel que soit votre choix, les débits effectués par ces deux options sont plafonnés par utilisateur (par défaut à trois échecs facturés sur une période de 24 heures), de sorte qu'un module qui échoue de manière répétée ne puisse pas vider le solde d'un client. La facturation à la minute des échecs au-delà de **Free Failed Builds per User per Day** n'est pas comprise dans ce plafond : elle est limitée par l'allocation quotidienne et par **Builds One User May Run at Once**. Un déploiement **réussi** est toujours intégralement facturé, quelle que soit la configuration retenue.

7. Enregistrez les **crédits promotionnels Google** propres à RAD, afin qu'une alerte se déclenche avant leur expiration : **Google Promotional Credits Left** (USD) et **Google Promotional Credits Expiry**, tous deux copiés depuis la console de facturation Google Cloud (**Billing** > **Credits**), ainsi que **Promotional Credits Warning** (nombre de jours avant expiration pour avertir, 30 par défaut). Un champ vide ou la valeur 0 signifie qu'aucun crédit n'est enregistré.
8. Renseignez la liste **Internal Accounts** : les domaines et adresses e-mail, séparés par des virgules, qui appartiennent à RAD. Les rapports de revenus et le rapport de campagne de lab les excluent par défaut (laisser vide cible les domaines TechEquity). Les règlements, commissions, soldes et facturations ne sont jamais impactés.
9. Les cinq **options de lab** désactivent chacune une fonctionnalité de lab sans interrompre l'ensemble des labs, et sont activées par défaut : **Lab Place-Price Check** (refuse les places payantes dont le tarif est inférieur à leur propre coût de revient ; à désactiver uniquement si une estimation erronée bloque tous les labs payants), **Lab Automatic Retry** (une nouvelle tentative automatique d'un environnement en échec), **Lab Scheduled Start**, **Lab Trainer Reminders** et **Lab Follow-Up Emails**.
10. Définissez les **limites de l'IA**, qui encadrent l'usage des fonctionnalités d'IA de RAD (Ask AI, l'assistant conversationnel, Build Solution with AI, les suggestions de correctifs et la réponse du formulaire de support). L'utilisation de l'IA n'étant jamais facturée en crédits, ces limites constituent le seul contrôle sur ce qu'elle coûte à RAD. Une modification enregistrée prend effet en quelques minutes :
   - **AI Calls per Day (per Paying Account)** — 100 par défaut (1 à 1 000), partagés entre toutes les fonctionnalités d'IA. Un compte est considéré comme payant s'il a acheté des crédits dans la fenêtre définie ci-dessous, ou s'il détient un rôle interne (administrateur, partenaire, finance, support, agent ou formateur).
   - **AI Calls per Day (per Free Account)** — 20 par défaut (1 à 1 000), et jamais supérieur au chiffre des comptes payants. Un compte gratuit qui atteint cette limite est informé que l'achat de crédits ou la souscription d'un abonnement permet de passer au niveau payant.
   - **Paid AI Allowance Lasts (Days After a Purchase)** — 90 par défaut (30 à 90). Une recharge ou un paiement d'abonnement maintient un compte au quota payant pendant ce nombre de jours ; détenir encore des crédits achetés issus d'un achat plus ancien ne suffit pas. Le renouvellement d'un abonnement équivaut à un achat.
   - **AI Calls per Day (Platform)** — 1 000 par défaut (1 à 100 000) : le plafond sur l'ensemble de la plateforme pour un jour UTC.
   - **AI Calls Kept for Paying Customers and Staff** — 50 % par défaut (0 % à 90 %) de ce plafond, afin que les comptes non payants ne puissent jamais utiliser plus que la part restante.
   - **Free AI-Advised Failed Builds** — 3 par défaut (0 à 10) : nombre de builds en échec pour lesquels un propriétaire sans crédits achetés peut solliciter **Suggest fixes**.

Cet onglet propose également la fonction **Adjust All Credits**, qui applique le montant saisi au solde de **chaque** utilisateur à la fois — positif pour attribuer, négatif pour déduire. Cochez **Free** pour modifier les crédits offerts, ou laissez décoché pour modifier les crédits achetés. Votre propre compte est systématiquement exclu, de même que, pour les crédits achetés, les comptes que vous avez parrainés. Une déduction ne peut jamais faire passer un solde sous zéro. Les ajustements importants (10 000 crédits ou plus) ne peuvent être validés tant que vous n'avez pas fourni de motif et saisi la phrase de confirmation affichée. Si un ajustement s'interrompt, soumettez à nouveau le même montant et le même type : les comptes déjà modifiés ne sont pas ajustés deux fois. Utilisez Credit Management ci-dessous pour modifier une personne en particulier.

Remarque : les interrupteurs généraux de la plateforme — **Enable Credits**, **Enable Subscription** et **Enable Project Credits** — se trouvent sur la page **Setup** de l'administrateur, inaccessible au rôle Finance. **Enable Subscription** régit tous les achats : lorsqu'il est désactivé, il n'y a plus de nouveaux abonnements ni de recharges ponctuelles sur aucun des fournisseurs, les options d'achat et d'abonnement disparaissent, et les abonnés existants peuvent toujours résilier leur formule depuis la page Credits. En tant que membre de l'équipe Finance, vous visualisez et configurez l'interface de facturation, mais vous n'activez ni ne désactivez ces fonctions depuis celle-ci.

### Credit Management {#credit-management}

Ajustez les soldes de crédits d'un utilisateur spécifique.

1. Allez dans **Billing** > **Credit Management**.
2. Recherchez l'utilisateur par son adresse e-mail.
3. Cliquez sur **Edit** et définissez les soldes. Il en existe trois, qui fonctionnent différemment : les **Awards** sont des crédits gratuits réinitialisés chaque mois, les crédits **Subscription** proviennent d'une formule et sont remplacés au renouvellement si la réinitialisation est activée, et les crédits **Top-up** ont été achetés directement et n'expirent jamais. Les dépenses consomment d'abord les crédits offerts, puis les crédits d'événement (obtenus avec un code d'événement, voir ci-dessous, non modifiables ici), puis les abonnements, et enfin les recharges. **Monthly Partner** n'est pas un solde consommable — c'est l'attribution récurrente ajoutée chaque mois aux Awards d'un partenaire.
4. Enregistrez la modification.

Deux éléments à prendre en compte. Vous ne pouvez pas modifier votre **propre** solde : l'enregistrement est rejeté et vous êtes invité à solliciter un autre utilisateur finance ou administrateur, garantissant ainsi une double identité sur chaque dotation. Et si quelqu'un d'autre a modifié le solde de cet utilisateur pendant que votre formulaire était ouvert, votre sauvegarde est rejetée, le formulaire se ferme et le tableau s'actualise — rouvrez-le et effectuez votre modification à partir du chiffre mis à jour.

Seuls les soldes que vous modifiez réellement sont enregistrés ; les autres restent strictement en l'état, y compris un solde négatif ou avec des décimales. Le formulaire de modification ne comporte pas de contrôle **Is Partner?** pour vous : le statut de partenaire est un rôle, et seuls les administrateurs peuvent modifier les rôles.

### Event Codes {#event-codes}

Offrez aux participants d'un événement partenaire (un DevFest, un atelier) des crédits gratuits qu'ils réclament eux-mêmes en saisissant un code.

1. Allez dans **Billing** > **Event Codes** et cliquez sur **New event code**.
2. Saisissez un code ou cliquez sur **Generate**, puis nommez l'événement (**Event**).
3. Définissez **Credits per claim** et **Maximum claims**. Le formulaire indique le volume maximal de crédits que le code peut distribuer (crédits × demandes) avant sa création.
4. Indiquez la date limite de demande **Claim until** (et éventuellement **Claim from**), ainsi que la date d'expiration des crédits — soit un nombre de **jours après la demande** (days after claiming), soit une **date d'expiration fixe** (fixed expiry date).
5. Vous pouvez éventuellement restreindre l'utilisation à certains **domaines de messagerie** ou à une liste de **participants** (une adresse e-mail par ligne), puis cliquer sur **Create code**.

Chaque personne ne peut demander un code qu'une seule fois, et uniquement avec une adresse e-mail validée — une fois par compte et une fois par adresse e-mail, de sorte qu'un alias d'adresse ou un compte supprimé puis réinscrit ne puisse pas le réclamer à nouveau. Les crédits sont versés sur le solde **Event credits** de l'utilisateur : ils sont gratuits (jamais comptabilisés comme achetés), sont dépensés après les dotations mensuelles, ne permettent pas de payer la consommation Google Cloud dans un projet géré par RAD, et expirent à leur propre date plutôt que lors de la réinitialisation mensuelle. Une fois le code créé, ses crédits et sa validité sont figés ; vous pouvez néanmoins le désactiver (**Disable**) ou le réactiver (**Enable**), reporter sa date de fin ou modifier son plafond. **Details** liste les personnes l'ayant réclamé, et **Export claims (CSV)** permet de télécharger cette liste.

**Vous ne pouvez pas réclamer de codes d'événement pour vous-même.** Les comptes Finance et administrateurs — qui créent les codes — se voient opposer un refus, et personne ne peut réclamer un code qu'il a lui-même créé, même après avoir perdu ce rôle. C'est la même règle qui vous interdit de modifier votre propre solde. L'encadré pour code d'événement sur la page Credits (la ligne **Claim credits**) ne vous est pas présenté pour cette raison ; tant que le programme de parrainage est actif, vous voyez à la place le lien **Get your referral link**.

### Module Revenue {#module-revenue}

Visualisez les revenus générés par les déploiements, ainsi que la part attribuée à chaque partenaire ou agent.

1. Allez dans **Billing** > **Module Revenue**. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour modifier la période, sélectionnez une date de début et de fin — l'intervalle ne peut pas dépasser 366 jours — puis cliquez sur **Refresh**.
3. Si aucun partenaire ni agent n'est sélectionné, vous consultez l'ensemble des revenus de la plateforme pour cette période. Sélectionnez un ou plusieurs partenaires (ou agents) pour restreindre l'affichage à leur part de revenus, calculée selon le pourcentage défini dans Credit Settings. Vous pouvez également filtrer par module.
4. Chaque ligne indique la date, le nom du module, l'e-mail de l'utilisateur, le coût en crédits et le revenu. **Export to CSV** exporte l'ensemble des données filtrées, pas seulement la page affichée à l'écran.
5. Les comptes internes de RAD (**Internal Accounts** dans Credit Settings) sont exclus, et une note indique combien de lignes ont ainsi été retirées. Cochez **Include RAD's own accounts** pour les afficher.

### Agent Revenue {#agent-revenue}

Commissions des agents et règlements associés. Un agent perçoit une part (le taux **Agent Revenue Share** configuré dans Credit Settings) des **frais de module** que ses utilisateurs parrainés paient avec des crédits **achetés**. Cette commission est calculée en dollars américains et versée en argent, hors de RAD. Les frais de build, l'utilisation de projet, les crédits offerts ou promotionnels, la surcharge de projet en libre-service et toutes les dépenses engagées dans un lab n'ouvrent jamais droit à commission. Le [Guide de l'agent](agent-guide.md#how-commission-works) détaille l'ensemble des règles.

L'onglet comporte deux parties.

**Le relevé de commissions.**

1. Allez dans **Billing** > **Agent Revenue** et choisissez un agent — actuel ou ancien, dans la mesure où un agent révoqué peut toujours avoir des commissions en attente. Vous voyez son relevé exactement comme lui : les totaux (Earned, Reversed, On hold, Payable, In payout, Paid) et une ligne par commission. Au-dessus, **Rewarded referrals this month** et **All-time rewarded referrals** indiquent combien de personnes l'agent a parrainées lui ayant rapporté des crédits de parrainage — sous forme de compteurs uniquement.
2. Chaque commission est **bloquée pendant 30 jours** avant de devenir payable, ce qui permet de traiter d'abord les éventuels frais remboursés ou contestés.
3. Pour annuler une commission, par exemple en cas de remboursement de frais, utilisez **Reverse** sur sa ligne et indiquez un motif. L'annulation est enregistrée sous forme d'une nouvelle écriture négative, jamais sous forme de modification. Si la commission n'a pas encore été payée, les deux écritures s'annulent — et si elle figure dans un lot de règlement qui n'est pas encore marqué comme payé, le total de ce lot diminue d'autant. Si elle a déjà été versée, le montant est déduit du prochain règlement de cet agent. Le motif est communiqué à l'agent et consigné dans le journal d'audit.
4. Les remboursements et rejets de débit sont pris en charge automatiquement. Lorsqu'un paiement client est remboursé ou fait l'objet d'un rejet de débit et que son solde acheté devient négatif, RAD annule les commissions de ce client encore **en attente** (on hold), de la plus récente à la plus ancienne, à concurrence du découvert. Une commission déjà versée n'est jamais récupérée automatiquement.

**Règlements des agents.**

1. Choisissez une date limite (**Cut-off date**) et cliquez sur **Create payout batch**. Le lot regroupe toutes les commissions payables avant cette date limite et déduit les éventuelles annulations.
2. Les agents à qui l'on doit moins que le **minimum de 50 $** sont reportés sur un lot ultérieur ; rien n'est perdu.
3. **Un agent désactivé est exclu.** Ses commissions restent enregistrées et bloquées, et ne seront payées dans un lot ultérieur que si le compte est réactivé. Un compte désactivé ne génère plus non plus de nouvelles commissions. Si un agent est désactivé **après** la création d'un lot, ce lot ne peut pas être marqué comme payé : réactivez le compte et marquez-le comme payé (si vous l'avez déjà réglé), ou utilisez **Remove inactive agents from this payout** — uniquement si vous ne l'avez **pas** encore payé — ce qui replace ses commissions en attente.
4. Réglez chaque agent hors de RAD, puis saisissez la référence de paiement (**Payment reference**) et marquez le lot comme payé. Le relevé de l'agent affiche alors ces commissions sous le statut **Paid**.

La création d'un lot, sa validation comme payé et l'annulation d'une commission génèrent chacune une entrée dans le journal d'audit.

### Linked Projects, Customer Billing and VAT {#linked-projects-customer-billing-and-vat}

Un client peut demander à RAD de payer Google pour un projet Google Cloud qu'il possède déjà (**Credits → Linked Projects** de son côté — voir le [Guide de l'utilisateur](user-guide.md#linked-projects)). RAD débite alors toutes les heures ses crédits achetés pour sa consommation, au tarif public de Google diminué des crédits Google que vous lui répercutez, augmenté de la **Linked Project Margin**, plus sa TVA. C'est sur ces trois onglets que vous gérez cela, et que la TVA de chaque client est définie.

**Customer Billing.** Recherchez un client par son adresse e-mail (les clients déjà configurés sont listés pour faciliter votre sélection) et définissez :

- **VAT rate (%)** — de 0 à 50. **0** signifie pas de TVA et est considéré comme défini ; laisser le champ vide le supprime, et un client sans taux ne peut pas être associé à un projet. Le taux s'applique à **tout** ce que ce client paie — frais de module, coûts de build et utilisation de projet géré par RAD, ainsi que consommation d'un projet associé — et pour une session de lab ou un projet client, c'est le taux de la personne qui le finance (le formateur ou l'abonné) qui s'applique. Il s'applique à compter du débit suivant et n'est jamais rétroactif : un déploiement conserve le taux qui était le sien lors de sa confirmation.
- **Country** (code à deux lettres) et **Tax ID**.
- **Billing sub-account ID** — facultatif. Il doit être ouvert, rattaché au compte de facturation revendeur de RAD et utilisable par les comptes de service de RAD ; RAD vérifie ces conditions lors de l'enregistrement et signale tout élément manquant, et **Re-check** relance le contrôle. Laissez vide pour utiliser le compte de facturation principal de RAD. Une modification s'applique aux projets associés ou créés par la suite, y compris les projets gérés par RAD créés pour ce client ; les projets existants ne sont jamais déplacés.
- **Crédits Google répercutés à ce client** — **Free tier**, **Sustained and committed use discounts** et **Promotions**, chacun désactivé par défaut (la consommation est facturée au tarif public). La marge de revendeur de RAD et ses remises négociées avec Google ne sont jamais répercutées.
- **Linked project floor override (credits)** — facultatif. Remplace le plancher fixe de projet associé de la plateforme pour ce client ; le plancher basé sur les jours de dépenses continue de s'appliquer en supplément, la valeur la plus élevée étant retenue. Laissez vide pour utiliser la valeur par défaut de la plateforme.

Vous ne pouvez pas modifier les paramètres de facturation de votre propre compte, ni approuver, rejeter ou dissocier vos propres projets associés — un autre utilisateur Finance ou un administrateur doit s'en charger.

**Save changes** n'enregistre que les champs modifiés. La section **Change history** située en dessous liste chaque modification, son ancienne et sa nouvelle valeur, son auteur et sa date.

**Linked Projects.** Toutes les demandes des clients, les demandes en attente en premier, avec le client, le statut, le compte de facturation et les dates.

- **Approve** associe immédiatement la facturation du projet à RAD, sur le sous-compte de facturation du client ou sur le compte principal de RAD. La boîte de dialogue affiche le taux de TVA du client, ses crédits achetés par rapport au plancher ainsi que son sous-compte, et vous devez cocher **Customer has capped Gemini API and GPU quotas** — vérifiez les quotas du projet avant de le faire. L'approbation est refusée (le motif est précisé dans la boîte de dialogue) tant que le client n'a pas de taux de TVA défini et ne détient pas au moins le plancher en crédits achetés — la valeur la plus élevée entre le plancher fixe et le plancher calculé sur les jours de dépenses récentes de ses projets associés. Elle est également refusée si le client n'est plus le propriétaire validé du projet, si le projet a été créé ou est exécuté par RAD (un projet géré par RAD, un lab ou un projet client), ou si le client a retiré le rôle de facturation de RAD de l'un de ses projets associés (la boîte de dialogue le nomme).
- **Reject** nécessite un motif, qui est communiqué au client.
- **Unlink** détache le compte de facturation de RAD d'un projet associé ou suspendu. Si le client n'a pas relié son propre compte, ses services s'arrêtent (ses données sont conservées). La consommation accumulée jusqu'alors reste facturée dès que le relevé est synchronisé.
- Une interruption — de votre fait ou de celui du client — ne se termine que lorsque RAD a confirmé que son compte de facturation n'est plus rattaché au projet. Si le détachement échoue, le projet reste avec le statut **Unlinking**, sa consommation reste facturée au client, et RAD réessaie toutes les 15 minutes ; **Retry detach** sur la ligne permet de relancer la tentative immédiatement. Si le client a retiré le rôle de facturation de RAD, RAD alerte ses administrateurs et ne peut achever l'arrêt tant que le rôle n'a pas été rétabli.

Vous ne suspendez pas les projets vous-même : RAD suspend un projet associé lorsque le solde acheté du client passe sous le plancher, après lui avoir envoyé un e-mail, et le rétablit dès qu'il effectue une recharge — sauf dans le cas où le client a retiré le rôle de facturation de RAD de l'un de ses projets associés, auquel cas aucun de ses projets n'est rétabli tant que le rôle n'a pas été restitué.

**VAT Report.** TVA collectée par client, par pays et par mois — TVA facturée moins TVA restituée sur les remboursements, y compris la TVA sur la consommation Google Cloud réglée tardivement par un client (une fois ces arriérés perçus) — en crédits, chaque débit étant calculé au taux figé au moment de sa réalisation, avec le montant équivalent en dollars américains à côté. Choisissez une plage de dates (**This month** et **Last month** sont des raccourcis) et un pays, basculez entre **By customer**, **By country** et **By month**, et utilisez **Export CSV**. Les transferts vers et depuis un séquestre de lab ou un portefeuille client sont exclus — la TVA est comptabilisée lors de la dépense effective de ces crédits.

### Missing Payments {#missing-payments}

Paiements signalés comme réussis par Stripe ou Flutterwave que RAD n'a pas crédités. Le rapprochement quotidien des paiements de RAD crédite la plupart d'entre eux automatiquement, par défaut lorsqu'il a constaté l'absence du même paiement lors de deux exécutions quotidiennes ; cet onglet répertorie ceux qui sont encore en attente — **Seen N day(s)** pendant que RAD poursuit son suivi, **Needs a person** dès lors qu'il est sorti de la fenêtre de rapprochement sans avoir été crédité.

1. Allez dans **Billing** > **Missing Payments**. Chaque ligne indique la date du paiement, le fournisseur, l'ID de paiement, le client, le montant et les crédits achetés.
2. Vérifiez dans le tableau de bord du fournisseur que le paiement a bien abouti et n'a pas été remboursé, puis cliquez sur **Credit** et **Credit payment**. Les crédits proviennent de l'enregistrement de ce paiement par RAD, et non d'une valeur que vous saisissez.

**Créditez toujours un paiement manquant ici, jamais en ajustant le solde du client.** Seule cette procédure marque le paiement comme crédité, évitant ainsi que le webhook renvoyé par le fournisseur ne le crédite une deuxième fois. S'il avait déjà été crédité, rien n'est ajouté et vous en êtes informé.

Les remboursements et rejets de débit ne requièrent aucune intervention de votre part : RAD annule les crédits accordés par un paiement remboursé ou contesté (au prorata en cas de remboursement partiel) sur le solde où ils ont été versés, même si cela le rend négatif, et les rétablit si un litige est tranché en faveur de RAD. Un paiement remboursé avant d'avoir été crédité ne sera jamais crédité ultérieurement.

### Project Transactions {#project-transactions}

Coûts des projets Google Cloud gérés par RAD pour chaque client, tels qu'ils ont été facturés.

1. Allez dans **Billing** > **Project Transactions**. L'onglet s'ouvre sur les 7 derniers jours.
2. Recherchez par ID de projet ou par adresse e-mail du propriétaire, ajustez les dates et cliquez sur **Search**.
3. Chaque ligne affiche le nom du projet et son ID, son propriétaire, les crédits débités et le coût total dans votre devise d'affichage, avec toute consommation encore **due** (non encore prélevée) indiquée à côté du débit. Toutes les pages de résultats sont chargées, de sorte que la pagination couvre l'ensemble de la période. Cet onglet ne propose pas d'export CSV.
4. La consommation signalée par Google après le règlement de la session de lab ou du projet client ayant financé un projet apparaît sous forme d'une valeur distincte **billed after settlement** sur la ligne de ce projet. Elle est facturée au payeur en tant que montant dû et ne fait pas partie du total débité.

### Project Invoices {#project-invoices}

Rapprochez les dépenses réelles sur Google Cloud.

1. Allez dans **Billing** > **Project Invoices**. L'onglet s'ouvre sur le mois en cours et charge ses données.
2. Choisissez un autre mois pour modifier la période ; **Fetch Project Invoice** recharge les informations.
3. Chaque ligne affiche le nom du projet et son ID, son propriétaire, le **coût public en crédits** (le coût au ratio crédits par unité, avant toute marge de projet — ce n'est donc pas le montant débité) et le coût total dans votre devise d'affichage. Les totaux situés sous le tableau portent sur la page affichée à l'écran et le précisent. **Export to CSV** exporte l'ensemble des projets pour ce mois.

Les coûts de module (**Module Costs**) par déploiement ne constituent pas un onglet de Billing — ils figurent sur la page **Credits**.

### Payout Summary {#payout-summary}

Consultez les totaux des règlements par bénéficiaire pour les partenaires et les agents. Cet onglet est accessible **exclusivement aux rôles Finance et Admin**.

1. Allez dans **Billing** > **Payout Summary**. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour générer un rapport sur une autre période, choisissez une date de début et une date de fin — toutes deux obligatoires, 366 jours au maximum — puis cliquez sur **Calculate Payouts**.
3. Chaque ligne indique l'e-mail du bénéficiaire, s'il est payé en tant qu'Agent, Partenaire ou les deux, le nombre de transactions, les crédits achetés correspondants, les revenus de configuration (**Setup Revenue**) perçus par un partenaire en tant qu'ingénieur sur des demandes de configuration traitées, ainsi que le montant dû (Amount Due) dans votre devise de facturation. Les chiffres des agents proviennent du registre des commissions, et le total servant de base à la commission comptabilise chaque dépense une seule fois, même lorsqu'elle rémunère à la fois un agent et un partenaire. Les totaux de la période apparaissent sous le tableau, et **Export to CSV** vous permet d'extraire cette même liste pour vos opérations.

#### Recording a partner payout {#recording-a-partner-payout}

RAD n'effectue pas de transferts d'argent — vous rémunérez les partenaires hors de la plateforme — mais une fois le versement effectué, enregistrez-le pour que vous et le partenaire disposiez d'une trace permanente.

1. Sélectionnez la période couverte par le paiement. **La période doit être terminée** : le bouton **Mark paid** reste désactivé tant que la période inclut la journée d'aujourd'hui, car les gains postérieurs à votre saisie ne pourraient jamais être versés.
2. Sur la ligne du partenaire, vous pouvez éventuellement renseigner votre référence de paiement, puis cliquer sur **Mark paid**.
3. RAD recalcule le montant dû au partenaire pour cette période et **l'enregistre avec les taux en vigueur à cet instant précis**. Ce montant conservé constitue la trace définitive : si le taux de partage des revenus change par la suite, le chiffre en direct sur cette page s'ajuste mais le paiement consigné ne change pas, et la ligne affiche les deux valeurs lorsqu'elles diffèrent.

Une période ne peut être enregistrée qu'une seule fois par partenaire ; marquer à nouveau la même période ne change rien, et une période qui chevauche une période déjà enregistrée pour ce partenaire est refusée. Chaque règlement enregistré génère une entrée dans le journal d'audit, et le partenaire peut le consulter dans la section **Payouts** de son onglet **Module Revenue**. Les commissions d'agent disposent de leur propre procédure de versement sur **Agent Revenue**.

## Consulter les utilisateurs, les agents et les partenaires {#viewing-users-agents-and-partners}

En tant que membre de l'équipe Finance, vous pouvez voir tous les utilisateurs ainsi que les listes complètes des agents et des partenaires.

- Consultez et recherchez chaque compte dans **Billing** > **Credit Management** : le tableau liste tous les utilisateurs et dispose d'un champ « Search by email ». Il n'y a pas de page Users distincte pour Finance ; celle-ci est réservée aux administrateurs.
- Visualisez les partenaires et les agents sur la plateforme via les sélecteurs présents sur **Module Revenue**, **Agent Revenue**, ainsi que dans le champ Assigned Engineer des Setup Requests.

### Modifications limitées des utilisateurs {#limited-user-edits}

La seule modification que vous pouvez apporter à un compte utilisateur concerne ses **soldes de crédits** (Awards, Subscription, Top-up et l'attribution Monthly Partner), et jamais sur votre propre compte.

Tous les **rôles** — y compris l'attribution ou la révocation du rôle **Partner** — ainsi que le statut **active** d'un utilisateur sont **réservés aux administrateurs**, de sorte que l'écran Credit Management ne vous affiche aucun contrôle relatif aux rôles. Vous pouvez néanmoins définir l'attribution **Monthly Partner** pour une personne détenant déjà le rôle Partner.

## Labs {#labs}

L'équipe Finance supervise les sessions de lab ; elle ne les exécute pas.

1. Cliquez sur **Labs** dans la barre de navigation (la même vue correspond à **Solutions → Managed Environments**). Vous visualisez les sessions de chaque formateur, avec une plage de dates, un filtre d'état et une colonne **Trainer**.
2. Ouvrez **Participants** sur une session pour consulter son règlement — engagé, consommé, remboursable, ainsi que tout montant absorbé par RAD — et ses participants. Le bouton **Export CSV** permet de télécharger la liste.
3. L'environnement de chaque participant ouvre une page de déploiement en lecture seule : statut du build et journaux, avec les secrets masqués. L'onglet **Outputs** ainsi que les mots de passe ou clés générés ne vous sont pas présentés ; ils appartiennent au participant et au formateur.
4. Le **Campaign report** situé sous les sessions permet de déterminer si les labs ont fonctionné en tant que campagne : par session, les places payées et conservées, les environnements tentés et prêts, ce que la subvention de RAD a couvert ou ce que RAD a absorbé, et combien de participants ont acheté des crédits, déployé par leurs propres moyens ou sont revenus dans les 30 jours. Choisissez les dates **From** et **To** ; les propres comptes de RAD sont exclus à moins de cocher **Include RAD's own accounts** ; **Export CSV** permet de le télécharger.

La seule modification que vous pouvez effectuer est **End now**, qui interrompt immédiatement les dépenses d'une session. Cela ne déplace aucun argent : le séquestre est réglé ultérieurement, une fois l'utilisation de Google Cloud de la session mesurée. Tout le reste — créer ou dupliquer des sessions, lancer les chronomètres, prolonger, ajouter ou supprimer des participants, renvoyer des invitations, provisionner et recharger — relève du formateur de la session ou d'un administrateur, et ces commandes ne vous sont pas présentées.

## Setup Requests {#setup-requests}

Les demandes d'installation gérée (managed-setup) émanant d'utilisateurs souhaitant que RAD prenne en charge un déploiement pour eux apparaissent ici.

1. Cliquez sur **Help** dans la barre de navigation, puis ouvrez l'onglet **Setup Requests**.
2. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement. Pour modifier cela, choisissez un filtre de statut ainsi qu'une date de début et de fin, puis cliquez sur **Load Requests**.
3. Développez une demande pour la traiter : définissez son **status** (new, in-progress, completed ou cancelled), choisissez un **Assigned Engineer** (seuls les partenaires enregistrés sont acceptés), enregistrez le **Revenue Achieved**, et ajoutez des notes internes. Cliquez sur **Save** pour appliquer.
4. L'enregistrement d'une demande avec le statut *completed* déclenche le calcul de la répartition des revenus entre la plateforme et l'ingénieur ; veillez donc à définir le montant des revenus avant de la marquer comme terminée. L'ingénieur conserve **75 %** et la plateforme **25 %** par défaut ; un administrateur peut configurer une part différente pour la plateforme (**Platform revenue share (setup requests)** dans les paramètres), et une part de 0 est prise en compte. Le paramètre **Partner Revenue Share** du module n'affecte pas les demandes d'installation. La modification du montant des revenus sur une demande déjà finalisée recalcule la répartition sans changer sa date d'achèvement. **Export to CSV** vous fournit l'ensemble chargé pour vos rapports.

## Audit Log {#audit-log}

Ouvrez **Audit Log** depuis la barre de navigation pour voir qui a modifié quoi, et quand, concernant les flux financiers de la plateforme. Votre vue affiche uniquement les actions liées aux finances : modifications de solde de crédits et ajustements groupés, récompenses de parrainage, paiements crédités par rapprochement (y compris depuis **Missing Payments**), crédits annulés ou restaurés après un remboursement ou un rejet de débit, remboursements automatiques d'un abonnement en double, changements de palier d'abonnement, exonérations des frais de premier déploiement et réajustements tarifaires des solutions, annulations et versements de commissions d'agent, versements aux partenaires, répartitions de revenus des demandes d'installation, codes d'événement, débits des sessions de lab, subventions, remboursements et règlements — y compris une place payée par un formateur pour le compte d'un participant (avec la note du formateur sur le paiement hors ligne, s'il en a laissé une) — modifications de facturation client et demandes, approbations, refus, suspensions et dissociations de projets associés, ainsi que l'approvisionnement, les recharges, les retraits, les frais d'exécution et le règlement du portefeuille de projets clients. Les administrateurs voient l'ensemble des actions.

- La page s'ouvre sur les 7 derniers jours. Modifiez les dates, choisissez une **Action**, ou saisissez une partie d'une adresse e-mail dans **Performed by**, puis sélectionnez **Load**. La plage peut aller jusqu'à un an.
- Sélectionnez **Show all** sur une ligne pour voir l'ensemble des informations enregistrées avec celle-ci, comme le solde avant et après une modification.
- Les résultats sont paginés sous le tableau ; choisissez 25, 50, 100 ou 200 lignes par page.
- Si une plage contient plus d'actions qu'un seul chargement ne peut en lire, seules les plus récentes sont affichées et une notification vous invite à restreindre les dates.

Le journal est en lecture seule.

## Obtenir de l'aide {#getting-help}

Cliquez sur **Help** dans la barre de navigation :

- Onglet **Send Message** — un formulaire de contact qui crée un ticket de support et envoie un e-mail à l'équipe d'assistance. L'onglet **My Tickets** situé à côté liste les tickets que vous avez ouverts ainsi que leur statut. Finance étant un rôle interne (staff), vous pouvez ouvrir un ticket sans avoir de crédits achetés sur votre compte (les utilisateurs ordinaires en ont besoin tant que les achats sont activés). Chaque compte peut ouvrir jusqu'à 5 tickets par période de 24 heures.
- Onglet **Setup Requests** — décrit ci-dessus.
- Onglet **Support Tickets** — la file d'attente partagée des tickets. La facturation étant l'une de ses catégories, vous pouvez effectuer le tri : l'équipe Finance et les administrateurs peuvent attribuer, réattribuer ou retirer l'assignation d'un ticket à n'importe qui, alors que les agents de support peuvent uniquement s'attribuer un ticket non assigné ou libérer un ticket dont ils ont la charge.

Le calculateur de **ROI** ne se trouve pas dans Help — il correspond au dernier onglet de la page **Credits**, **Calculate ROI**. Credits n'apparaît dans votre navigation que si votre compte détient également le rôle d'utilisateur ordinaire ; dans le cas contraire, rendez-vous directement sur `/credits`. Sans le rôle utilisateur, vous ne disposez pas de grand livre de crédits personnel : la page ne propose donc pas **Credit Transactions** et s'ouvre directement sur **Module Revenue** ; **Module Costs** et **Project Invoices** y figurent comme d'habitude.

Un lien **Contact Us** situé dans le pied de page vous redirige également vers la page Help.
