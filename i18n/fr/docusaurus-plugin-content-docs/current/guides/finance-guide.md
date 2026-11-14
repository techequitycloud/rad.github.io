---
title: "Guide financier"
description: "Guide financier de la plateforme RAD — paramètres de tarification et de crédits, octrois de crédits et codes d'événement, revenus et paiements, rapprochement des coûts Google Cloud et supervision des sessions de lab."
---

<!-- translated-from: docs/guides/finance-guide.md @ 40c83c3f sha256:adfc4a154dba -->

# Guide financier {#finance-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Finance_Guide.png" alt="Guide financier" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide est destiné aux personnes ayant le rôle **Finance**, qui gèrent la configuration de la facturation de RAD, exécutent les rapports de revenus et de paiements, et rapprochent les coûts cloud. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

Le rôle Finance est accordé par un administrateur en plus d'un compte ordinaire, vous conservez donc tout ce qu'un utilisateur inscrit possède. Lorsque vous vous connectez en tant que Finance, vous arrivez sur la page **Billing** (Facturation). Votre barre de navigation affiche d'abord **Billing** (Facturation), **Labs** (Labs) et **Audit Log** (Journal d'audit), puis les éléments quotidiens que votre compte contient également — **Credits** (Crédits), **Deployments** (Déploiements) et **Solutions** pour un compte utilisateur ordinaire — et enfin **Pricing** (Tarification) et **Help** (Aide). (**Labs** n'apparaît que lorsque les sessions de lab sont activées, et **Setup Requests** (Demandes de configuration) et **Support Tickets** (Tickets de support) sont des onglets dans la page Help.)

## Ce que vous pouvez faire {#what-you-can-do}

- Créer et modifier les formules d'abonnement et leurs prix par fournisseur (**Subscription Tiers**).
- Configurer l'économie des crédits — crédits par unité, frais, remises et parts de revenus (**Credit Settings**).
- Ajuster le solde de crédits de tout autre utilisateur (**Credit Management**).
- Émettre des **Event Codes** (Codes d'événement) qui donnent des crédits gratuits aux participants à un événement.
- Approuver ou rejeter les demandes des clients pour que RAD paie leurs propres projets Google Cloud (**Linked Projects**), définir le taux de TVA, les détails fiscaux et le sous-compte de facturation de chaque client (**Customer Billing**), et rapporter la TVA collectée (**VAT Report**).
- Rapporter les **Module Revenue** (Revenus des modules), et examiner et payer les commissions des agents (**Agent Revenue**).
- Examiner les coûts des projets gérés par RAD de chaque client (**Project Transactions**) et les coûts GCP à l'échelle de l'organisation (**Project Invoices**).
- Voir les totaux des paiements par bénéficiaire (**Payout Summary**).
- Superviser les sessions de lab de chaque formateur, et en terminer une pour arrêter ses dépenses (**Labs**).
- Voir tous les projets clients sur la plateforme — qui l'exécute, pour quel client, son statut et son portefeuille — en lecture seule, sous **Solutions → Managed Environments → Client projects → All client projects** (lorsque les projets clients sont activés).
- Afficher tous les utilisateurs et les listes complètes d'agents et de partenaires ; effectuer des modifications limitées des utilisateurs.
- Gérer les files d'attente de configuration gérée et de tickets de support (onglets sur la page Help).
- Examiner les entrées liées à l'argent du **Audit Log**.

## La page Billing {#the-billing-page}

Ouvrez **Billing** (Facturation) depuis la barre de navigation. Elle comporte douze onglets, dans cet ordre : **Subscription Tiers**, **Credit Settings**, **Credit Management**, **Event Codes**, **Linked Projects**, **Customer Billing**, **VAT Report**, **Module Revenue**, **Agent Revenue**, **Project Transactions**, **Project Invoices** et **Payout Summary**. Chacun est décrit ci-dessous.

Les onglets qui apparaissent dépendent de deux interrupteurs de la plateforme. **Event Codes**, **Linked Projects**, **Customer Billing** et **VAT Report** sont toujours affichés ; tous les autres onglets nécessitent que **Enable Subscription** soit activé, et **Project Transactions** et **Project Invoices** nécessitent également **Enable Project Credits**. La page s'ouvre toujours sur le premier onglet que vous pouvez utiliser — avec les abonnements désactivés, c'est **Event Codes**. **Linked Projects**, **Customer Billing** et **VAT Report** sont réservés à la Finance : les administrateurs ne les voient pas.

### Subscription Tiers {#subscription-tiers}

Gérez les formules de crédits récurrentes (paliers) auxquelles les utilisateurs peuvent s'abonner. Chaque formule accorde un nombre défini de crédits par cycle de facturation.

1. Allez dans **Billing** > **Subscription Tiers**.
2. Cliquez pour **créer** un nouveau palier, ou sélectionnez un palier existant pour le **modifier**.
3. Définissez le nom de la formule, son prix et les crédits qu'elle accorde. Le formulaire indique ce que ce prix achèterait au taux actuel de crédits par unité, afin que vous puissiez voir si le palier offre une meilleure valeur qu'une simple recharge. Ensuite, sur chaque onglet de fournisseur, collez l'identifiant du prix correspondant que vous avez **déjà créé dans le tableau de bord de ce fournisseur** — **Price ID** pour Stripe, **Plan ID** pour Flutterwave. Le prix et les crédits sont partagés par les deux fournisseurs ; seul l'identifiant diffère.
4. Enregistrez le palier. Mettez à jour ou supprimez les paliers au fur et à mesure que vos offres changent.

Au-dessus du tableau des paliers se trouve un panneau **Payment Providers**. Utilisez-le pour activer ou désactiver **Stripe** et **Flutterwave** — l'onglet d'un fournisseur dans le tableau des paliers reste désactivé tant que ce fournisseur est désactivé, et aucun ne peut être activé tant que les crédits et les abonnements ne sont pas tous deux activés. Le même panneau contient **Reset Subscription Credits** : laissez-le désactivé et les crédits d'abonnement inutilisés sont reportés sur le cycle de facturation suivant ; activez-le et l'allocation est remplacée à chaque renouvellement au lieu d'être ajoutée. Les crédits de recharge ne sont jamais affectés dans un sens ou dans l'autre.

Les abonnements n'accordent que des crédits — ils n'accordent pas le rôle de Partenaire.

### Credit Settings {#credit-settings}

Configurez les paramètres globaux de l'économie des crédits.

1. Allez dans **Billing** > **Credit Settings**.
2. Définissez la valeur **credits-per-unit** (comment les crédits sont mappés à la devise).
3. Définissez les **revenue shares** — le pourcentage de revenus alloué aux **agents** référents (Agent Revenue Share) et aux **partenaires** de modules (Partner Revenue Share).
4. Configurez le reste de l'économie à partir du même onglet. Chaque paramètre est son propre petit formulaire avec son propre bouton Save, afin que vous puissiez en modifier un sans toucher aux autres : les octrois de crédits gratuits (Signup, Monthly, Referral et la limite de parrainage), le **Minimum Top-up** (le plus petit achat unique en dollars US : 10 $ par défaut, entre 1 $ et 1 000 $), le déclencheur de crédits faibles, les crédits par heure (utilisés uniquement pour les sessions de lab, les projets clients et lorsque la facturation des builds à la minute est cochée), la taille du **starter pack** (150 crédits par défaut, soit 15 $ à 10 crédits par dollar : le premier achat proposé aux utilisateurs, dimensionné pour dépasser le seuil de 100 crédits du sandbox avec une marge de manœuvre ; il n'est proposé que si son achat dépasse le seuil du palier dans lequel l'utilisateur déploie, sinon l'utilisateur voit son réel déficit), l'interrupteur **monthly award for active users only** et sa fenêtre (activé, 30 jours : l'octroi mensuel ne va qu'aux utilisateurs ayant un déploiement réussi ou un achat dans cette fenêtre), les quatre frais de module (CR et GKE, frais et frais de configuration), la remise sur les modules gérés par RAD, le tampon de crédits de déploiement, les seuils d'admission Sandbox/Development/Production/Lab et les budgets mensuels des projets, la marge de crédits de projet, les trois paramètres de projets liés (**Linked Project Margin**, 10 % par défaut et entre 0 % et 100 %, ajouté au prix catalogue de Google pour le propre projet lié d'un client ; **Linked Project Floor**, 2 500 crédits par défaut ; et **Linked Project Floor (days of spend)**, 7 par défaut — un client lié doit détenir le plus grand du seuil fixe et de ce nombre de jours de ses dépenses récentes), l'intervalle de rafraîchissement du déploiement, **Billing Reconciliation Alert** (en dollars US, 1 par défaut, jusqu'à 10 000 : RAD alerte ses administrateurs lorsque plus que ce montant de coût Google Cloud dans une fenêtre de facturation n'a pas pu être attribué à quiconque), et les valeurs de départ pour le calculateur de ROI. La limite de parrainage (**Referral Rewards**) prend trois types de valeurs : **-1** signifie illimité, **0** désactive le programme de parrainage (pas de crédits de parrainage, et la section **Refer and earn** disparaît du Profil, ainsi que son raccourci sur les Crédits), et un nombre positif est le nombre mensuel de parrainages pour lesquels chaque parrain gagne des crédits. Les agents sont exemptés de ce plafond mensuel. Les **Solution bundle discounts** n'ont pas de contrôle sur cet onglet : les frais de module d'une solution sont réduits de 15 % pour trois ou quatre membres, 20 % pour cinq ou six et 25 % pour sept ou plus, et la modification de ces paliers est une modification des paramètres de l'administrateur (`solutionBundleDiscountTiers`), pas un formulaire ici.
5. Définissez comment les déploiements paient les builds, sur les cartes **Build pricing** à côté de Credits per Hour :
   - **Charge build time per minute** — décoché par défaut, ce qui signifie que les **builds sont inclus dans le prix** : un déploiement ne paie que ses frais de module ; les mises à jour sont gratuites jusqu'à **Updates Included per Month** (5) pour chaque déploiement, puis **Price of Each Further Update** (2 crédits) ; les destructions, purges et builds échoués sont gratuits ; Project_GCP et Services_GCP sont inclus sous une application et coûtent **Project_GCP on Its Own** (10) et **Services_GCP on Its Own** (20) lorsqu'ils sont déployés seuls. Cocher cette option rétablit la facturation à la minute à Credits per Hour.
   - **First Deployment Free** — activé par défaut : le premier déploiement réussi d'un module par chaque utilisateur est exempt de ses frais de module, quels que soient les frais et qui a publié le module, une fois par utilisateur. Il s'applique à un module d'application que les propres crédits de l'utilisateur paient (dans une solution, le premier membre à réussir), jamais à une session de lab ou à un projet client. Project_GCP et Services_GCP déployés seuls ne sont jamais gratuits : ils sont facturés à leur prix fixe (10 et 20 crédits par défaut) et n'utilisent pas l'offre.

   Les sessions de lab et les portefeuilles de projets clients sont toujours facturés pour le temps de build à la minute à Credits per Hour.
   - La modification de **Charge build time per minute** modifie une condition de prix publiée, le formulaire vous demande donc de **Confirm** avant d'enregistrer. Mettez à jour la page de tarification, les conditions et les guides en conséquence.
6. Décidez ce qui est facturé pour un **déploiement échoué**, sur la carte **Failed Deployments**. Il a deux interrupteurs indépendants, et chaque étiquette indique son propre résultat ("Build cost charged" / "Build cost not charged", "Module fee charged" / "Module fee not charged") :
   - **Build cost** — si le temps mesuré de Cloud Build d'un nouveau déploiement qui échoue ou est annulé est facturé. Cela n'a d'importance que lorsque la facturation des builds à la minute est cochée (et pour les portefeuilles de lab et de projets clients) ; avec les builds inclus, un build échoué est toujours gratuit.
   - **Module fee** — si les frais de module sont facturés pour ce déploiement même s'il n'a jamais réussi.

   **Dans la version actuelle, les deux sont désactivés : aucun déploiement échoué n'est facturé.** L'activation de l'un ou l'autre s'applique aux déploiements qui échouent à partir de ce moment-là ; elle ne refacture jamais les échecs passés. Les interrupteurs couvrent uniquement l'échec de la *création* d'un déploiement — les mises à jour et les suppressions échouées ne sont pas facturées, et les déploiements de lab sont facturés via la session du formateur. Quoi que vous choisissiez, les frais pour les échecs sont plafonnés par utilisateur (par défaut à trois échecs facturés sur 24 heures), de sorte qu'un module qui continue d'échouer ne peut pas vider le solde d'un client. Un déploiement **réussi** est toujours facturé en totalité, quelle que soit la configuration de ces paramètres.

Cet onglet contient également **Adjust All Credits**, qui applique le montant que vous saisissez au solde de **chaque** utilisateur à la fois — positif pour accorder, négatif pour déduire. Cochez **Free** pour déplacer les crédits offerts, ou laissez-le vide pour déplacer les crédits achetés. Les ajustements importants ne seront pas soumis tant que vous n'aurez pas donné une raison et tapé la phrase de confirmation affichée. Utilisez Credit Management ci-dessous pour modifier une seule personne.

Note : les interrupteurs de la plateforme — **Enable Credits**, **Enable Subscription** et **Enable Project Credits** — se trouvent sur la page **Setup** de l'administrateur, que la Finance ne peut pas ouvrir. **Enable Subscription** est l'interrupteur pour chaque achat : s'il est désactivé, il n'y a pas de nouveaux abonnements ni de recharges uniques chez aucun des fournisseurs, les options d'achat et d'abonnement disparaissent, et les abonnés existants peuvent toujours annuler leur formule depuis la page Credits. En tant que Finance, vous voyez et configurez l'interface utilisateur de facturation, mais vous ne les activez ou désactivez pas à partir de celle-ci.

### Credit Management {#credit-management}

Ajustez les soldes de crédits d'un utilisateur individuel.

1. Allez dans **Billing** > **Credit Management**.
2. Recherchez l'utilisateur par e-mail.
3. Cliquez sur **Edit** et définissez les soldes. Il y en a trois, et ils se comportent différemment : les **Awards** sont des crédits gratuits réinitialisés chaque mois, les crédits **Subscription** proviennent d'une formule et sont remplacés au renouvellement lorsque la réinitialisation est activée, et les crédits **Top-up** ont été achetés directement et n'expirent jamais. Les dépenses sont prélevées d'abord sur les awards, puis sur les crédits d'événement (réclamés avec un code d'événement, ci-dessous, et non modifiables ici), puis sur l'abonnement, puis sur la recharge. **Monthly Partner** n'est pas un solde dépensable — c'est l'allocation récurrente ajoutée aux Awards d'un partenaire chaque mois.
4. Enregistrez la modification.

Deux choses à prévoir. Vous ne pouvez pas ajuster votre **propre** solde : l'enregistrement est rejeté et on vous dit de demander à un autre utilisateur financier ou administrateur, ce qui maintient deux identités sur chaque octroi. Et si quelqu'un d'autre a modifié le solde de cet utilisateur pendant que votre formulaire de modification était ouvert, votre enregistrement est rejeté, le formulaire se ferme et le tableau se rafraîchit — rouvrez-le et effectuez la modification à partir du chiffre actuel.

Seuls les soldes que vous modifiez réellement sont enregistrés ; les autres sont laissés exactement tels quels, y compris un solde négatif ou partiel. Le formulaire de modification n'a pas de contrôle **Is Partner?** pour vous : le statut de partenaire est un rôle, et seuls les administrateurs modifient les rôles.

### Event Codes {#event-codes}

Donnez aux participants à un événement partenaire (un DevFest, un atelier) des crédits gratuits qu'ils réclament eux-mêmes en saisissant un code.

1. Allez dans **Billing** > **Event Codes** et cliquez sur **New event code**.
2. Saisissez un code ou cliquez sur **Generate**, et nommez l'**Event**.
3. Définissez **Credits per claim** et **Maximum claims**. Le formulaire indique le montant maximal que le code peut distribuer (crédits × réclamations) avant que vous ne le créiez.
4. Définissez **Claim until** (et éventuellement **Claim from**), et la date d'expiration des crédits — soit un nombre de **days after claiming** soit une **fixed expiry date**.
5. Restreignez-le éventuellement aux **email domains** ou à une liste d'**attendees** (un e-mail par ligne), puis cliquez sur **Create code**.

Chaque compte peut réclamer un code une seule fois, et uniquement avec une adresse e-mail vérifiée. Les crédits sont versés dans le solde **Event credits** de l'utilisateur : ils sont gratuits (jamais comptés comme achetés), sont dépensés après les récompenses mensuelles, ne paient pas l'utilisation de Google Cloud dans un projet géré par RAD, et expirent à leur propre date plutôt qu'avec la réinitialisation mensuelle. Une fois qu'un code existe, ses crédits et sa validité sont fixes ; vous pouvez toujours le **Disable** ou l'**Enable**, déplacer sa date de clôture, ou modifier son plafond. **Details** liste qui l'a réclamé, et **Export claims (CSV)** télécharge cette liste.

**Vous ne pouvez pas réclamer de codes d'événement vous-même.** Les comptes Finance et administrateur — les comptes qui créent les codes — sont refusés, et personne ne peut réclamer un code qu'il a créé, même après avoir perdu le rôle. C'est la même règle qui vous empêche d'ajuster votre propre solde. La boîte de code d'événement sur la page Crédits (la ligne **Claim credits**) ne vous est pas affichée pour cette raison ; tant que le programme de parrainage est activé, vous voyez un lien **Get your referral link** à la place.

### Module Revenue {#module-revenue}

Visualisez les revenus générés par les déploiements et la part allouée à chaque partenaire ou agent.

1. Allez dans **Billing** > **Module Revenue**. Il s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour modifier la période, choisissez une date de début et une date de fin — la plage ne peut pas dépasser 366 jours — et cliquez sur **Refresh**.
3. Sans partenaire ou agent sélectionné, vous examinez les revenus complets de la plateforme pour cette période. Sélectionnez un ou plusieurs partenaires (ou agents) pour restreindre les résultats à leur part de revenus, calculée à partir du pourcentage défini dans Credit Settings. Vous pouvez également filtrer par module.
4. Chaque ligne affiche la date, le nom du module, l'e-mail de l'utilisateur, le coût en crédits et les revenus. **Export to CSV** exporte l'ensemble filtré complet, pas seulement la page affichée à l'écran.

### Agent Revenue {#agent-revenue}

Commission d'agent et les paiements qui la règlent. Un agent gagne une part (la **Agent Revenue Share** dans Credit Settings) des **frais de module** que leurs utilisateurs parrainés paient avec des crédits **achetés**. Elle est calculée en dollars US et payée en espèces, en dehors de RAD. Les frais de build, l'utilisation de projet, les crédits offerts ou promotionnels, la surtaxe de projet en libre-service et tout ce qui est dépensé dans un lab ne génèrent jamais de revenus. Le [guide de l'agent](agent-guide.md#how-commission-works) contient toutes les règles.

L'onglet a deux parties.

**Le relevé de commission.**

1. Allez dans **Billing** > **Agent Revenue** et choisissez un agent — actuel ou ancien, car un agent déclassé peut toujours avoir des commissions dues. Vous voyez son relevé exactement comme il le voit : totaux (Earned, Reversed, On hold, Payable, In payout, Paid) et une ligne par commission. Au-dessus, **Rewarded referrals this month** et **All-time rewarded referrals** indiquent combien de personnes l'agent a parrainées et qui lui ont rapporté des crédits de parrainage — uniquement des décomptes.
2. Chaque commission est **en attente pendant 30 jours** avant de devenir payable, afin qu'un frais remboursé ou contesté puisse être traité en premier.
3. Pour annuler une commission, par exemple parce que ses frais ont été remboursés, utilisez **Reverse** sur sa ligne et donnez une raison. L'annulation est enregistrée comme une nouvelle entrée négative, jamais une modification. Si la commission n'a pas encore été payée, la paire s'annule — et si elle se trouve dans un lot de paiement qui n'est pas encore marqué comme payé, le total de ce lot diminue du même montant. Si elle a été payée, le montant est déduit du prochain paiement de cet agent. La raison est affichée à l'agent et écrite dans le journal d'audit.

**Paiements des agents.**

1. Choisissez une **Cut-off date** et cliquez sur **Create payout batch**. Le lot prend toutes les commissions payables à la date limite et annule toutes les annulations.
2. Les agents dont le montant dû est inférieur au **minimum de 50 $** sont reportés sur un lot ultérieur ; rien n'est perdu.
3. **Un agent désactivé est exclu.** Sa commission reste enregistrée et en attente, et n'est payée dans un lot ultérieur que si le compte est réactivé. Un compte désactivé ne gagne également aucune nouvelle commission.
4. Payez chaque agent en dehors de RAD, puis saisissez la **Payment reference** et marquez le lot comme payé. Le relevé de l'agent affiche alors ces commissions comme **Paid**.

La création d'un lot, le fait de le marquer comme payé et l'annulation d'une commission écrivent chacun une entrée dans le journal d'audit.

### Linked Projects, Customer Billing et VAT {#linked-projects-customer-billing-and-vat}

Un client peut demander à RAD de payer Google pour un projet Google Cloud qu'il possède déjà (**Credits → Linked Projects** de son côté — voir le [Guide de l'utilisateur](user-guide.md#linked-projects)). RAD débite alors ses crédits achetés toutes les heures pour son utilisation, au prix catalogue de Google moins les crédits Google que vous leur transmettez, plus la **Linked Project Margin**, plus leur TVA. Ces trois onglets sont l'endroit où vous gérez cela, et où la TVA de chaque client est définie.

**Customer Billing.** Recherchez un client par e-mail (les clients déjà configurés sont listés pour que vous puissiez les choisir) et définissez :

- **VAT rate (%)** — 0 à 50. **0** signifie pas de TVA et est considéré comme défini ; le laisser vide l'efface, et un client sans taux ne peut pas être lié. Le taux s'applique à **tout** ce que ce client paie — frais de module, coûts de build et utilisation de projet géré par RAD ainsi que l'utilisation d'un projet lié — et pour une session de lab ou un projet client, c'est le taux de celui qui le finance (le formateur ou l'abonné). Il s'applique à partir de la prochaine facturation et n'est jamais rétroactif : un déploiement conserve le taux auquel il a été confirmé.
- **Country** (code à deux lettres) et **Tax ID**.
- **Billing sub-account ID** — facultatif. Il doit être ouvert, se trouver sous le compte de facturation revendeur de RAD et être utilisable par les comptes de service de RAD ; RAD vérifie cela lorsque vous enregistrez et nomme tout ce qui manque, et **Re-check** exécute la vérification à nouveau. Laissez-le vide pour utiliser le compte de facturation principal de RAD. Un changement s'applique aux projets liés ou créés par la suite, y compris les projets gérés par RAD que RAD crée pour ce client ; les projets existants ne sont jamais déplacés.
- **Google credits passed to this customer** — **Free tier**, **Sustained and committed use discounts** et **Promotions**, chacun désactivé par défaut (l'utilisation est facturée au prix catalogue). La marge revendeur de RAD et ses remises négociées avec Google ne sont jamais transmises.
- **Linked project floor override (credits)** — facultatif. Remplace le seuil fixe de projet lié de la plateforme pour ce client ; le seuil de jours de dépenses s'applique toujours en plus, le plus grand des deux étant retenu. Laissez vide pour utiliser la valeur par défaut de la plateforme.

Vous ne pouvez pas modifier les paramètres de facturation de votre propre compte, ni approuver, rejeter ou délier vos propres projets liés — un autre utilisateur Finance ou un administrateur doit le faire.

**Save changes** n'enregistre que les champs que vous avez modifiés. L'**Change history** en dessous liste chaque modification, son ancienne et nouvelle valeur, qui l'a faite et quand.

**Linked Projects.** Chaque demande client, celles en attente en premier, avec le client, le statut, le compte de facturation et les dates.

- **Approve** lie la facturation du projet à RAD immédiatement, sur le sous-compte de facturation du client ou sur le compte principal de RAD. La boîte de dialogue affiche le taux de TVA du client, les crédits achetés par rapport au seuil, et le sous-compte, et vous devez cocher **Customer has capped Gemini API and GPU quotas** — vérifiez les quotas du projet avant de le faire. L'approbation est refusée (la raison est affichée dans la boîte de dialogue) tant que le client n'a pas de taux de TVA défini et ne détient pas au moins le seuil en crédits achetés — le plus grand du seuil fixe et du seuil de jours de dépenses sur les dépenses récentes de leurs projets liés. Elle est également refusée si le client n'est plus le propriétaire vérifié du projet, si le projet est un projet créé ou géré par RAD (un projet géré par RAD, de lab ou client), ou si le client a supprimé le rôle de facturation de RAD de l'un de ses projets liés (la boîte de dialogue le nomme).
- **Reject** nécessite une raison, que le client voit.
- **Unlink** détache le compte de facturation de RAD d'un projet lié ou mis en pause. Si le client n'a pas lié le sien, ses services s'arrêtent (ses données sont conservées). L'utilisation jusqu'alors est toujours facturée une fois que la mesure est rattrapée.
- Un arrêt — le vôtre ou celui du client — ne se termine qu'une fois que RAD a confirmé que son compte de facturation est désactivé du projet. Si le détachement échoue, le projet reste **Unlinking**, son utilisation est toujours facturée au client, et RAD réessaie toutes les 15 minutes ; **Retry detach** sur la ligne réessaie immédiatement. Si le client a supprimé le rôle de facturation de RAD, RAD alerte ses administrateurs et ne peut pas terminer l'arrêt tant que le rôle n'est pas restauré.

Vous ne mettez pas les projets en pause vous-même : RAD met en pause un projet lié lorsque le solde acheté du client tombe en dessous du seuil, après lui avoir envoyé un e-mail, et le restaure lorsqu'il recharge — sauf lorsque le client a supprimé le rôle de facturation de RAD de l'un de ses projets liés, auquel cas rien de ce qui lui appartient n'est restauré tant qu'il n'est pas rétabli.

**VAT Report.** TVA collectée par client, par pays et par mois — TVA facturée moins TVA remboursée sur les remboursements, y compris la TVA sur l'utilisation de Google Cloud qu'un client a payée en retard (une fois ces arriérés collectés) — en crédits, chaque facturation au taux instantané au moment de la transaction, avec un chiffre en dollars US à côté. Choisissez une plage de dates (**This month** et **Last month** sont des raccourcis) et un pays, basculez entre **By customer**, **By country** et **By month**, et utilisez **Export CSV**. Les mouvements d'entrée et de sortie d'un compte séquestre de lab ou d'un portefeuille client sont exclus — la TVA est comptabilisée lorsque ces crédits sont dépensés.

### Project Transactions {#project-transactions}

Coûts de chaque projet Google Cloud géré par RAD pour chaque client, tels qu'ils ont été facturés.

1. Allez dans **Billing** > **Project Transactions**. Il s'ouvre sur les 7 derniers jours.
2. Recherchez par ID de projet ou e-mail du propriétaire, ajustez les dates et cliquez sur **Search**.
3. Chaque ligne affiche le projet, son propriétaire et les crédits facturés. Chaque page de résultats est chargée, de sorte que les totaux et les exportations couvrent toute la période.
4. L'utilisation signalée par Google après le règlement de la session de lab ou du projet client qui a financé un projet apparaît comme un chiffre distinct **billed after settlement** sur la ligne de ce projet. Elle est facturée au financeur comme un montant dû et ne fait pas partie du total facturé.

### Project Invoices {#project-invoices}

Rapprochez les dépenses réelles de Google Cloud.

1. Allez dans **Billing** > **Project Invoices**. Il s'ouvre sur le mois en cours et le charge.
2. Choisissez un autre mois pour le modifier ; **Fetch Project Invoice** recharge.
3. Chaque ligne affiche le nom et l'ID du projet, son propriétaire, le **list cost in credits** (le coût au taux de crédits par unité, avant toute marge de projet — ce n'est donc pas le montant débité) et le coût total dans votre devise d'affichage. Les totaux sous le tableau couvrent la page affichée et le précisent. **Export to CSV** exporte tous les projets pour ce mois.

Les **Module Costs** par déploiement ne sont pas un onglet de facturation — ils se trouvent sur la page **Credits**.

### Payout Summary {#payout-summary}

Visualisez les totaux des paiements par bénéficiaire pour les partenaires et les agents. Cet onglet est disponible pour la **finance et l'administration uniquement**.

1. Allez dans **Billing** > **Payout Summary**. Il s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour générer un rapport sur une autre période, choisissez une date de début et une date de fin — toutes deux obligatoires, maximum 366 jours — puis cliquez sur **Calculate Payouts**.
3. Chaque ligne affiche l'e-mail du bénéficiaire, s'il est payé en tant qu'Agent, Partenaire ou les deux, le nombre de transactions, les crédits achetés correspondants, les **Setup Revenue** qu'un partenaire a gagnés en tant qu'ingénieur sur les demandes de configuration terminées, et le montant dû dans votre devise de facturation. Les chiffres des agents proviennent du grand livre des commissions, et le total de la base de commission compte chaque dépense une fois, même lorsqu'elle a payé à la fois un agent et un partenaire. Les totaux de période apparaissent sous le tableau, et **Export to CSV** vous donne la même liste pour travailler.

#### Enregistrer un paiement partenaire {#recording-a-partner-payout}

RAD n'envoie pas d'argent — vous payez les partenaires en dehors de la plateforme — mais une fois que vous l'avez fait, enregistrez-le afin que vous et le partenaire ayez un enregistrement durable.

1. Sélectionnez la période couverte par le paiement. **La période doit être terminée** : **Mark paid** reste désactivé tant que la période inclut aujourd'hui, car tout ce qui est gagné après votre enregistrement ne pourrait jamais être payé.
2. Sur la ligne du partenaire, saisissez éventuellement votre référence de paiement, puis cliquez sur **Mark paid**.
3. RAD recalcule le montant du partenaire pour cette période et **le stocke avec les taux en vigueur à ce moment-là**. Ce chiffre stocké est l'enregistrement permanent : si le taux de partage des revenus change plus tard, le chiffre en direct sur cette page bouge mais le paiement enregistré ne bouge pas, et la ligne affiche les deux lorsqu'ils diffèrent.

Une période peut être enregistrée une fois par partenaire ; marquer la même période à nouveau ne change rien, et une période qui chevauche une période déjà enregistrée pour ce partenaire est refusée. Chaque paiement enregistré écrit une entrée d'audit, et le partenaire la voit dans la section **Payouts** de son onglet **Module Revenue**. La commission d'agent a son propre flux de paiement sur **Agent Revenue**.

## Affichage des utilisateurs, agents et partenaires {#viewing-users-agents-and-partners}

En tant que Finance, vous pouvez voir tous les utilisateurs et les listes complètes d'agents et de partenaires.

- Affichez et recherchez chaque compte sur **Billing** > **Credit Management** — le tableau liste tous les utilisateurs et dispose d'une boîte "Search by email". Il n'y a pas de page Utilisateurs séparée pour la Finance ; celle-ci est réservée aux administrateurs.
- Affichez les partenaires et agents sur la plateforme via les sélecteurs sur **Module Revenue**, **Agent Revenue** et le champ Assigned Engineer sur les demandes de configuration.

### Modifications limitées des utilisateurs {#limited-user-edits}

La seule modification que vous pouvez apporter à un compte utilisateur concerne ses **soldes de crédits** (Awards, Subscription, Top-up et l'allocation Monthly Partner), et jamais sur votre propre compte.

Tous les **rôles** — y compris l'octroi ou la révocation du rôle de **Partenaire** — et le statut **actif** d'un utilisateur sont **réservés aux administrateurs**, de sorte que l'écran de gestion des crédits ne vous affiche aucun contrôle de rôle. Vous pouvez toujours définir l'allocation **Monthly Partner** pour quelqu'un qui détient déjà le rôle de Partenaire.

## Labs {#labs}

La Finance supervise les sessions de lab ; elle ne les exécute pas.

1. Cliquez sur **Labs** dans la barre de navigation (la même vue est **Solutions → Managed Environments**). Vous voyez les sessions de chaque formateur, avec une plage de dates, un filtre de statut et une colonne **Trainer**.
2. Ouvrez **Participants** sur une session pour voir son règlement — engagé, consommé, remboursable, et tout ce qui est absorbé par RAD — et ses participants. **Export CSV** télécharge la liste.
3. L'environnement de chaque participant ouvre une page de déploiement en lecture seule : statut et journaux de build, avec les secrets masqués. L'onglet **Outputs** et les mots de passe ou clés générés ne vous sont pas affichés ; ils appartiennent au participant et au formateur.

La seule modification que vous pouvez apporter est **End now**, qui arrête immédiatement les dépenses d'une session. Cela ne déplace pas d'argent : le séquestre est réglé plus tard, une fois que l'utilisation de Google Cloud de la session a été mesurée. Tout le reste — créer ou dupliquer des sessions, démarrer des chronomètres, prolonger, ajouter ou supprimer des participants, renvoyer des invitations, provisionner et recharger — appartient au formateur de la session ou à un administrateur, et ces contrôles ne vous sont pas affichés.

## Demandes de configuration {#setup-requests}

Les demandes de configuration gérée émanant d'utilisateurs qui souhaitent que RAD gère un déploiement pour eux apparaissent ici.

1. Cliquez sur **Help** (Aide) dans la barre de navigation, puis ouvrez l'onglet **Setup Requests** (Demandes de configuration).
2. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement. Pour le modifier, choisissez un filtre d'état ainsi qu'une date de début et de fin, puis cliquez sur **Load Requests** (Charger les demandes).
3. Développez une demande pour la traiter : définissez son **status** (état) (new, in-progress, completed ou cancelled), choisissez un **Assigned Engineer** (ingénieur assigné) (seuls les partenaires enregistrés sont acceptés), enregistrez le **Revenue Achieved** (revenu réalisé) et ajoutez des notes internes. Cliquez sur **Save** (Enregistrer) pour appliquer.
4. L'enregistrement d'une demande comme *completed* (terminée) est ce qui calcule la répartition entre la plateforme et le revenu de l'ingénieur. Définissez donc le chiffre d'affaires avant de la marquer comme terminée. L'ingénieur conserve **75 %** et la plateforme **25 %** par défaut ; un administrateur peut définir une part de plateforme différente (**Platform revenue share (setup requests)** dans les paramètres), et une part de 0 est honorée. Le module **Partner Revenue Share** n'affecte pas les demandes de configuration. La modification du revenu d'une demande déjà terminée recalcule la répartition sans modifier sa date d'achèvement. **Export to CSV** (Exporter au format CSV) vous donne l'ensemble chargé pour le reporting.

## Journal d'audit {#audit-log}

Ouvrez **Audit Log** (Journal d'audit) depuis la barre de navigation pour voir qui a modifié quoi, et quand, sur l'argent de la plateforme. Votre vue affiche uniquement les actions liées à l'argent : changements de solde de crédits et ajustements en masse, attributions de parrainage, annulations et paiements de commissions d'agent, répartitions des revenus des demandes de configuration, codes d'événement, frais de session de lab, remboursements et règlements — y compris un emplacement payé par un formateur au nom d'un participant (avec la note du formateur concernant le paiement hors ligne, s'il en a laissé une) — et modifications de la facturation client et demandes de projets liés, approbations, rejets, pauses et dissociations. Les administrateurs voient toutes les actions.

- La page s'ouvre sur les 7 derniers jours. Modifiez les dates, choisissez une **Action**, ou tapez une partie d'un e-mail dans **Performed by** (Effectué par), puis sélectionnez **Load** (Charger). La plage peut aller jusqu'à un an.
- Sélectionnez **Show all** (Tout afficher) sur une ligne pour voir tout ce qui y est enregistré, comme le solde avant et après un changement.
- Les résultats sont paginés sous le tableau ; choisissez 25, 50, 100 ou 200 lignes par page.
- Si une plage contient plus d'actions qu'un seul chargement ne peut en lire, seules les plus récentes sont affichées et une notification vous demande de réduire les dates.

Le journal est en lecture seule.

## Obtenir de l'aide {#getting-help}

Cliquez sur **Help** (Aide) dans la barre de navigation :

- Onglet **Send Message** (Envoyer un message) — un formulaire de contact qui génère un ticket de support et envoie un e-mail à l'équipe de support. L'onglet **My Tickets** (Mes tickets) à côté répertorie les tickets que vous avez créés et leur statut. La finance est un rôle de personnel, vous pouvez donc créer un ticket sans crédits achetés sur votre compte (les utilisateurs ordinaires en ont besoin lorsque les achats sont activés). Chaque compte peut créer jusqu'à 5 tickets par 24 heures.
- Onglet **Setup Requests** (Demandes de configuration) — décrit ci-dessus.
- Onglet **Support Tickets** (Tickets de support) — la file d'attente partagée des tickets. Comme la facturation est l'une de ses catégories, vous pouvez la trier : les financiers et les administrateurs peuvent assigner, réassigner ou effacer l'assignataire d'un ticket à n'importe qui, tandis que les agents de support ne peuvent que réclamer un ticket non assigné ou libérer un ticket qu'ils détiennent.

Le calculateur de **ROI** ne se trouve pas dans l'aide — c'est le dernier onglet de la page **Credits** (Crédits), **Calculate ROI** (Calculer le ROI). **Credits** (Crédits) n'apparaît dans votre navigation que si votre compte détient également le rôle d'utilisateur ordinaire ; sinon, allez directement à `/credits`. Sans le rôle d'utilisateur, vous n'avez pas votre propre grand livre de crédits, donc la page n'offre pas **Credit Transactions** (Transactions de crédits) et s'ouvre sur **Module Revenue** (Revenus des modules) à la place ; **Module Costs** (Coûts des modules) et **Project Invoices** (Factures de projets) sont là comme d'habitude.

Un lien **Contact Us** (Nous contacter) dans le pied de page vous amène également à la page d'aide.
