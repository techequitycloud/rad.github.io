---
title: "Guide financier"
description: "Guide financier de la plateforme RAD : tarification et paramètres de crédit, octrois de crédit et codes d'événement, revenus et paiements, rapprochement des coûts Google Cloud et supervision des sessions de laboratoire."
---

<!-- translated-from: docs/guides/finance-guide.md @ 15fd4c7 sha256:70f646eef3a3 -->

# Guide financier {#finance-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Finance_Guide.png" alt="Guide financier" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide est destiné aux personnes ayant le rôle **Finance**, qui gèrent la configuration de la facturation de RAD, exécutent les rapports de revenus et de paiements, et rapprochent les coûts du cloud. Nouveau sur RAD ? Commencez par [Utiliser RAD](using-rad.md).

Le rôle Finance est accordé par un administrateur en plus d'un compte ordinaire, de sorte que vous conservez tout ce qu'un utilisateur inscrit possède. Lorsque vous vous connectez en tant que Finance, vous arrivez sur la page **Billing** (Facturation). Votre barre de navigation affiche d'abord **Billing** (Facturation), **Labs** (Laboratoires) et **Audit Log** (Journal d'audit), puis les éléments quotidiens que votre compte contient également — **Credits** (Crédits), **Deployments** (Déploiements) et **Solutions** pour un compte utilisateur ordinaire — et enfin **Pricing** (Tarification) et **Help** (Aide). (**Labs** (Laboratoires) n'apparaît que lorsque les sessions de laboratoire sont activées, et **Setup Requests** (Demandes de configuration) et **Support Tickets** (Tickets de support) sont des onglets dans la page Aide.)

## Ce que vous pouvez faire {#what-you-can-do}

- Créer et modifier les plans d'abonnement et leurs prix par fournisseur (**Subscription Tiers** (Paliers d'abonnement)).
- Configurer l'économie des crédits — crédits par unité, frais, remises et part des revenus (**Credit Settings** (Paramètres de crédit)).
- Ajuster le solde de crédits de tout autre utilisateur (**Credit Management** (Gestion des crédits)).
- Émettre des **Event Codes** (Codes d'événement) qui donnent des crédits gratuits aux participants à un événement.
- Approuver ou rejeter les demandes des clients pour que RAD paie leurs propres projets Google Cloud (**Linked Projects** (Projets liés)), définir le taux de TVA, les détails fiscaux et le sous-compte de facturation de chaque client (**Customer Billing** (Facturation client)), et déclarer la TVA collectée (**VAT Report** (Rapport de TVA)).
- Rapporter les **Module Revenue** (Revenus des modules), et examiner et payer les commissions des agents (**Agent Revenue** (Revenus des agents)).
- Examiner les coûts des projets gérés par RAD de chaque client (**Project Transactions** (Transactions de projet)) et les coûts GCP de l'organisation (**Project Invoices** (Factures de projet)).
- Voir les totaux des paiements par bénéficiaire (**Payout Summary** (Récapitulatif des paiements)).
- Superviser les sessions de laboratoire de chaque formateur, et en terminer une pour arrêter ses dépenses (**Labs** (Laboratoires)).
- Voir tous les projets clients sur la plateforme — qui l'exécute, pour quel client, son statut et son portefeuille — en lecture seule, sous **Solutions → Managed Environments → Client projects → All client projects** (Solutions → Environnements gérés → Projets clients → Tous les projets clients) (lorsque les projets clients sont activés).
- Afficher tous les utilisateurs et les listes complètes d'agents et de partenaires ; effectuer des modifications limitées des utilisateurs.
- Gérer les files d'attente des demandes de configuration gérées et des tickets de support (onglets sur la page Aide).
- Examiner les entrées liées à l'argent du **Audit Log** (Journal d'audit).

## La page Billing (Facturation) {#the-billing-page}

Ouvrez **Billing** (Facturation) depuis la barre de navigation. Elle comporte douze onglets, dans cet ordre : **Subscription Tiers** (Paliers d'abonnement), **Credit Settings** (Paramètres de crédit), **Credit Management** (Gestion des crédits), **Event Codes** (Codes d'événement), **Linked Projects** (Projets liés), **Customer Billing** (Facturation client), **VAT Report** (Rapport de TVA), **Module Revenue** (Revenus des modules), **Agent Revenue** (Revenus des agents), **Project Transactions** (Transactions de projet), **Project Invoices** (Factures de projet) et **Payout Summary** (Récapitulatif des paiements). Chacun est décrit ci-dessous.

Les onglets qui apparaissent dépendent de deux commutateurs de plateforme. **Event Codes** (Codes d'événement), **Linked Projects** (Projets liés), **Customer Billing** (Facturation client) et **VAT Report** (Rapport de TVA) sont toujours affichés ; tous les autres onglets nécessitent que **Enable Subscription** (Activer l'abonnement) soit activé, et **Project Transactions** (Transactions de projet) et **Project Invoices** (Factures de projet) nécessitent également **Enable Project Credits** (Activer les crédits de projet). La page s'ouvre toujours sur le premier onglet que vous pouvez utiliser — avec les abonnements désactivés, c'est **Event Codes** (Codes d'événement). **Linked Projects** (Projets liés), **Customer Billing** (Facturation client) et **VAT Report** (Rapport de TVA) sont réservés à la Finance : les administrateurs ne les voient pas.

### Subscription Tiers (Paliers d'abonnement) {#subscription-tiers}

Gérez les plans de crédit récurrents (paliers) auxquels les utilisateurs peuvent s'abonner. Chaque plan accorde un nombre défini de crédits par cycle de facturation.

1. Allez dans **Billing** (Facturation) > **Subscription Tiers** (Paliers d'abonnement).
2. Cliquez pour **créer** un nouveau palier, ou sélectionnez un palier existant pour le **modifier**.
3. Définissez le nom du plan, son prix et les crédits qu'il accorde. Le formulaire indique ce que ce prix achèterait au taux actuel de crédits par unité, afin que vous puissiez voir si le palier offre une meilleure valeur qu'une simple recharge. Ensuite, sur chaque onglet de fournisseur, collez l'identifiant du prix correspondant que vous avez **déjà créé dans le tableau de bord de ce fournisseur** — **Price ID** (ID de prix) pour Stripe, **Plan ID** (ID de plan) pour Flutterwave. Le prix et les crédits sont partagés par les deux fournisseurs ; seul l'identifiant diffère.
4. Enregistrez le palier. Mettez à jour ou supprimez les paliers au fur et à mesure que vos offres évoluent.

Au-dessus du tableau des paliers se trouve un panneau **Payment Providers** (Fournisseurs de paiement). Utilisez-le pour activer ou désactiver **Stripe** et **Flutterwave** — l'onglet d'un fournisseur dans le tableau des paliers reste désactivé tant que ce fournisseur est désactivé, et aucun ne peut être activé tant que les crédits et les abonnements sont tous deux activés. Le même panneau contient **Reset Subscription Credits** (Réinitialiser les crédits d'abonnement) : laissez-le désactivé et les crédits d'abonnement inutilisés sont reportés sur le cycle de facturation suivant ; activez-le et l'allocation est remplacée à chaque renouvellement au lieu d'être ajoutée. Les crédits de recharge ne sont jamais affectés dans un sens ou dans l'autre.

Les abonnements n'accordent que des crédits — ils n'accordent pas le rôle de partenaire.

### Credit Settings (Paramètres de crédit) {#credit-settings}

Configurez les paramètres globaux de l'économie des crédits.

1. Allez dans **Billing** (Facturation) > **Credit Settings** (Paramètres de crédit).
2. Définissez la valeur des **crédits par unité** (comment les crédits sont mappés à la devise).
3. Définissez les **parts de revenus** — le pourcentage de revenus alloué aux **agents** référents (Agent Revenue Share) et aux **partenaires** de modules (Partner Revenue Share).
4. Définissez le reste de l'économie à partir du même onglet. Chaque paramètre est son propre petit formulaire avec son propre bouton Enregistrer, de sorte que vous pouvez en modifier un sans toucher aux autres : les octrois de crédits gratuits (Inscription, Mensuel, Parrainage et la limite de parrainage), le **Minimum Top-up** (Recharge minimale) (le plus petit achat unique en dollars américains : 10 $ par défaut, entre 1 $ et 1 000 $), le déclencheur de crédits faibles, les crédits par heure, les quatre frais de module (CR et GKE, frais et frais de configuration), la remise sur les modules gérés par RAD, le tampon de crédits de déploiement, les seuils d'admission et les budgets mensuels de projet pour Sandbox/Développement/Production/Lab, la marge de crédits de projet, les trois paramètres de projets liés (**Linked Project Margin** (Marge de projet lié), 10 % par défaut, ajoutée au prix catalogue de Google pour le propre projet lié d'un client ; **Linked Project Floor** (Seuil de projet lié), 2 500 crédits par défaut ; et **Linked Project Floor (days of spend)** (Seuil de projet lié (jours de dépense)), 7 par défaut — un client lié doit détenir le plus grand du seuil fixe et de ce nombre de jours de ses dépenses récentes), l'intervalle de rafraîchissement du déploiement, et les valeurs de départ pour le calculateur de ROI. La limite de parrainage (**Referral Rewards** (Récompenses de parrainage)) prend trois types de valeurs : **-1** signifie illimité, **0** désactive le programme de parrainage (pas de crédits de parrainage, et la section **Refer and earn** (Parrainer et gagner) disparaît du profil, ainsi que son raccourci sur les crédits), et un nombre positif est le nombre mensuel de parrainages pour lesquels chaque parrain gagne des crédits. Les agents sont exemptés de ce plafond mensuel. Les **Solution bundle discounts** (Remises sur les lots de solutions) n'ont aucun contrôle sur cet onglet : les frais de module d'une solution sont réduits de 15 % pour trois ou quatre membres, de 20 % pour cinq ou six et de 25 % pour sept ou plus, et la modification de ces paliers est une modification des paramètres de l'administrateur (`solutionBundleDiscountTiers`), pas un formulaire ici.
5. Décidez ce qu'un **déploiement échoué** est facturé, sur la carte **Failed Deployments** (Déploiements échoués). Il a deux commutateurs indépendants, et chaque étiquette indique son propre résultat ("Build cost charged" (Coût de build facturé) / "Build cost not charged" (Coût de build non facturé), "Module fee charged" (Frais de module facturés) / "Module fee not charged" (Frais de module non facturés)) :
   - **Build cost** (Coût de build) — si le temps Cloud Build mesuré d'un nouveau déploiement qui échoue ou est annulé est facturé.
   - **Module fee** (Frais de module) — si les frais de module sont facturés pour ce déploiement même s'il n'a jamais réussi.

   **Dans la version actuelle, les deux sont désactivés : aucun déploiement échoué n'est facturé.** L'activation de l'un ou l'autre s'applique aux déploiements qui échouent à partir de ce moment ; elle ne refacture jamais les échecs passés. Les commutateurs couvrent l'échec de la *création* d'un déploiement uniquement — les mises à jour et les suppressions échouées ne sont pas facturées, et les déploiements de laboratoire sont facturés via la session du formateur à la place. Quoi que vous choisissiez, les frais pour les échecs sont plafonnés par utilisateur (par défaut à trois échecs facturés sur 24 heures), de sorte qu'un module qui ne cesse d'échouer ne peut pas vider le solde d'un client. Un déploiement **réussi** est toujours facturé en totalité, quelle que soit la façon dont ceux-ci sont configurés.

Cet onglet contient également **Adjust All Credits** (Ajuster tous les crédits), qui applique le montant que vous entrez au solde de **chaque** utilisateur à la fois — positif pour accorder, négatif pour déduire. Cochez **Free** (Gratuit) pour déplacer les crédits offerts, ou laissez-le vide pour déplacer les crédits achetés. Les ajustements importants ne seront pas soumis tant que vous n'aurez pas donné une raison et tapé la phrase de confirmation affichée. Utilisez la gestion des crédits ci-dessous pour modifier une seule personne à la place.

Note : les commutateurs de plateforme — **Enable Credits** (Activer les crédits), **Enable Subscription** (Activer l'abonnement) et **Enable Project Credits** (Activer les crédits de projet) — se trouvent sur la page **Setup** (Configuration) de l'administrateur, que la Finance ne peut pas ouvrir. **Enable Subscription** (Activer l'abonnement) est le commutateur pour chaque achat : s'il est désactivé, il n'y a pas de nouveaux abonnements et pas de recharges uniques chez aucun des fournisseurs, les options d'achat et d'abonnement disparaissent, et les abonnés existants peuvent toujours annuler leur plan depuis la page Crédits. En tant que Finance, vous voyez et configurez l'interface utilisateur de facturation, mais vous ne l'activez ni ne la désactivez à partir de celle-ci.

### Credit Management (Gestion des crédits) {#credit-management}

Ajustez les soldes de crédits d'un utilisateur individuel.

1. Allez dans **Billing** (Facturation) > **Credit Management** (Gestion des crédits).
2. Recherchez l'utilisateur par e-mail.
3. Cliquez sur **Edit** (Modifier) et définissez les soldes. Il y en a trois, et ils se comportent différemment : les **Awards** (Récompenses) sont des crédits gratuits réinitialisés chaque mois, les crédits d'**Subscription** (Abonnement) proviennent d'un plan et sont remplacés au renouvellement lorsque la réinitialisation est activée, et les crédits de **Top-up** (Recharge) ont été achetés directement et n'expirent jamais. Les dépenses sont prélevées d'abord sur les récompenses, puis sur les crédits d'événement (réclamés avec un code d'événement, ci-dessous, et non modifiables ici), puis sur l'abonnement, puis sur la recharge. **Monthly Partner** (Partenaire mensuel) n'est pas un solde dépensable — c'est l'allocation récurrente ajoutée aux récompenses d'un partenaire chaque mois.
4. Enregistrez la modification.

Deux choses à prévoir. Vous ne pouvez pas ajuster votre **propre** solde : l'enregistrement est rejeté et il vous est demandé de demander à un autre utilisateur financier ou administrateur, ce qui maintient deux identités sur chaque octroi. Et si quelqu'un d'autre a modifié le solde de cet utilisateur pendant que votre formulaire de modification était ouvert, votre enregistrement est rejeté, le formulaire se ferme et le tableau se rafraîchit — rouvrez-le et effectuez la modification à partir du chiffre actuel.

Seuls les soldes que vous modifiez réellement sont enregistrés ; les autres sont laissés exactement tels qu'ils sont, y compris un solde négatif ou partiel. Le formulaire de modification n'a pas de contrôle **Is Partner?** (Est partenaire ?) pour vous : le statut de partenaire est un rôle, et seuls les administrateurs modifient les rôles.

### Event Codes (Codes d'événement) {#event-codes}

Donnez aux participants à un événement partenaire (un DevFest, un atelier) des crédits gratuits qu'ils réclament eux-mêmes en entrant un code.

1. Allez dans **Billing** (Facturation) > **Event Codes** (Codes d'événement) et cliquez sur **New event code** (Nouveau code d'événement).
2. Tapez un code ou cliquez sur **Generate** (Générer), et nommez l'**Event** (Événement).
3. Définissez les **Credits per claim** (Crédits par réclamation) et les **Maximum claims** (Réclamations maximales). Le formulaire indique le maximum que le code peut donner (crédits × réclamations) avant que vous ne le créiez.
4. Définissez **Claim until** (Réclamer jusqu'à) (et éventuellement **Claim from** (Réclamer à partir de)), et quand les crédits expirent — soit un nombre de **days after claiming** (jours après la réclamation) ou une **fixed expiry date** (date d'expiration fixe).
5. Restreignez-le éventuellement aux **email domains** (domaines de messagerie) ou à une liste d'**attendees** (participants) (un e-mail par ligne), puis cliquez sur **Create code** (Créer un code).

Chaque compte peut réclamer un code une fois, et uniquement avec une adresse e-mail vérifiée. Les crédits sont versés sur le solde **Event credits** (Crédits d'événement) de l'utilisateur : ils sont gratuits (jamais comptés comme achetés), sont dépensés après les récompenses mensuelles, ne paient pas l'utilisation de Google Cloud dans un projet géré par RAD, et expirent à leur propre date plutôt qu'avec la réinitialisation mensuelle. Une fois qu'un code existe, ses crédits et sa validité sont fixes ; vous pouvez toujours le **Disable** (Désactiver) ou l'**Enable** (Activer), déplacer sa date de clôture ou modifier son plafond. **Details** (Détails) liste qui l'a réclamé, et **Export claims (CSV)** (Exporter les réclamations (CSV)) télécharge cette liste.

**Vous ne pouvez pas réclamer de codes d'événement vous-même.** Les comptes Finance et administrateur — les comptes qui créent les codes — sont refusés, et personne ne peut réclamer un code qu'il a créé, même après avoir perdu le rôle. C'est la même règle qui vous empêche d'ajuster votre propre solde. La boîte de code d'événement sur la page Crédits (la ligne **Claim credits** (Réclamer des crédits)) ne vous est pas affichée pour cette raison ; tant que le programme de parrainage est activé, vous voyez un lien **Get your referral link** (Obtenir votre lien de parrainage) à la place.

### Module Revenue (Revenus des modules) {#module-revenue}

Voir les revenus générés par les déploiements, et la part allouée à chaque partenaire ou agent.

1. Allez dans **Billing** (Facturation) > **Module Revenue** (Revenus des modules). Il s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour modifier la période, choisissez une date de début et une date de fin — la plage ne peut pas dépasser 366 jours — et cliquez sur **Refresh** (Actualiser).
3. Sans partenaire ou agent sélectionné, vous examinez les revenus complets de la plateforme pour cette période. Sélectionnez un ou plusieurs partenaires (ou agents) pour restreindre à leur part de revenus, calculée à partir du pourcentage défini dans les paramètres de crédit. Vous pouvez également filtrer par module.
4. Chaque ligne affiche la date, le nom du module, l'e-mail de l'utilisateur, le coût en crédits et les revenus. **Export to CSV** (Exporter au format CSV) prend l'ensemble filtré complet, pas seulement la page à l'écran.

### Agent Revenue (Revenus des agents) {#agent-revenue}

Commission d'agent et les paiements qui la règlent. Un agent gagne une part (la **Agent Revenue Share** (Part de revenus de l'agent) dans les paramètres de crédit) des **frais de module** que ses utilisateurs parrainés paient avec des crédits **achetés**. Elle est calculée en dollars américains et payée en espèces, en dehors de RAD. Les frais de build, l'utilisation du projet, les crédits offerts ou promotionnels, la surcharge de projet en libre-service et tout ce qui est dépensé dans un laboratoire ne génèrent jamais de revenus. Le [guide de l'agent](agent-guide.md#how-commission-works) contient les règles complètes.

L'onglet comporte deux parties.

**Le relevé de commission.**

1. Allez dans **Billing** (Facturation) > **Agent Revenue** (Revenus des agents) et choisissez un agent — actuel ou ancien, car un agent déclassé peut toujours avoir des commissions dues. Vous voyez son relevé exactement comme il le voit : totaux (Gagné, Annulé, En attente, Payable, En paiement, Payé) et une ligne par commission. Au-dessus, **Rewarded referrals this month** (Parrainages récompensés ce mois-ci) et **All-time rewarded referrals** (Parrainages récompensés de tous les temps) indiquent le nombre de personnes que l'agent a parrainées et qui lui ont rapporté des crédits de parrainage — uniquement des comptes.
2. Chaque commission est **en attente pendant 30 jours** avant de devenir payable, afin qu'un remboursement ou un litige puisse être traité en premier.
3. Pour annuler une commission, par exemple parce que ses frais ont été remboursés, utilisez **Reverse** (Annuler) sur sa ligne et donnez une raison. L'annulation est enregistrée comme une nouvelle entrée négative, jamais une modification. Si la commission n'a pas encore été payée, la paire s'annule — et si elle se trouve dans un lot de paiement qui n'est pas encore marqué comme payé, le total de ce lot diminue du même montant. Si elle a été payée, le montant est déduit du prochain paiement de cet agent. La raison est affichée à l'agent et inscrite dans le journal d'audit.

**Paiements des agents.**

1. Choisissez une **Cut-off date** (Date limite) et cliquez sur **Create payout batch** (Créer un lot de paiement). Le lot prend toutes les commissions payables à la date limite et annule toutes les annulations.
2. Les agents dont le montant dû est inférieur au **minimum de 50 $** sont reportés sur un lot ultérieur ; rien n'est perdu.
3. **Un agent désactivé est exclu.** Sa commission reste enregistrée et en attente, et n'est payée dans un lot ultérieur que si le compte est réactivé. Un compte désactivé ne gagne également aucune nouvelle commission.
4. Payez chaque agent en dehors de RAD, puis entrez la **Payment reference** (Référence de paiement) et marquez le lot comme payé. Le relevé de l'agent affiche alors ces commissions comme **Paid** (Payées).

La création d'un lot, le fait de le marquer comme payé et l'annulation d'une commission écrivent chacun une entrée dans le journal d'audit.

### Linked Projects (Projets liés), Customer Billing (Facturation client) et TVA {#linked-projects-customer-billing-and-vat}

Un client peut demander à RAD de payer Google pour un projet Google Cloud qu'il possède déjà (**Credits → Linked Projects** (Crédits → Projets liés) de son côté — voir le [Guide de l'utilisateur](user-guide.md#linked-projects)). RAD débite alors ses crédits achetés toutes les heures pour son utilisation, au prix catalogue de Google moins les crédits Google que vous leur transmettez, plus la **Linked Project Margin** (Marge de projet lié), plus leur TVA. Ces trois onglets sont l'endroit où vous gérez cela, et où la TVA de chaque client est définie.

**Customer Billing** (Facturation client). Recherchez un client par e-mail (les clients déjà configurés sont listés pour que vous puissiez les choisir) et définissez :

- **VAT rate (%)** (Taux de TVA (%)) — 0 à 50. **0** signifie pas de TVA et est considéré comme défini ; le laisser vide l'efface, et un client sans taux ne peut pas être lié. Le taux s'applique à **tout** ce que ce client paie — frais de module, coûts de build et utilisation de projet géré par RAD ainsi que l'utilisation d'un projet lié — et pour une session de laboratoire ou un projet client, c'est le taux de celui qui le finance (le formateur ou l'abonné). Il s'applique à partir de la prochaine facturation et n'est jamais rétroactif : un déploiement conserve le taux auquel il a été confirmé.
- **Country** (Pays) (code à deux lettres) et **Tax ID** (ID fiscal).
- **Billing sub-account ID** (ID de sous-compte de facturation) — facultatif. Il doit être ouvert, se trouver sous le compte de facturation revendeur de RAD et être utilisable par les comptes de service de RAD ; RAD vérifie cela lorsque vous enregistrez et nomme tout ce qui manque, et **Re-check** (Revérifier) exécute la vérification à nouveau. Laissez-le vide pour utiliser le compte de facturation principal de RAD. Une modification s'applique aux projets liés ou créés par la suite, y compris les projets gérés par RAD que RAD crée pour ce client ; les projets existants ne sont jamais déplacés.
- **Google credits passed to this customer** (Crédits Google transmis à ce client) — **Free tier** (Niveau gratuit), **Sustained and committed use discounts** (Remises pour utilisation soutenue et engagée) et **Promotions**, chacun désactivé par défaut (l'utilisation est facturée au prix catalogue). La marge de revendeur de RAD et ses remises négociées avec Google ne sont jamais transmises.

**Save changes** (Enregistrer les modifications) enregistre uniquement les champs que vous avez modifiés. L'**Change history** (Historique des modifications) ci-dessous liste chaque modification, son ancienne et sa nouvelle valeur, qui l'a effectuée et quand.

**Linked Projects** (Projets liés). Chaque demande client, les demandes en attente en premier, avec le client, le statut, le compte de facturation et les dates.

- **Approve** (Approuver) lie la facturation du projet à RAD immédiatement, sur le sous-compte de facturation du client ou le compte principal de RAD. La boîte de dialogue affiche le taux de TVA du client, les crédits achetés par rapport au seuil, et le sous-compte, et vous devez cocher **Customer has capped Gemini API and GPU quotas** (Le client a plafonné les quotas d'API Gemini et de GPU) — vérifiez les quotas du projet avant de le faire. L'approbation est refusée (la raison est affichée dans la boîte de dialogue) tant que le client n'a pas un taux de TVA défini et ne détient pas au moins le seuil en crédits achetés.
- **Reject** (Rejeter) nécessite une raison, que le client voit.
- **Unlink** (Dissocier) détache le compte de facturation de RAD d'un projet lié ou mis en pause. Si le client n'a pas lié le sien, ses services s'arrêtent (leurs données sont conservées). L'utilisation jusqu'alors est toujours facturée une fois que la mesure est rattrapée.

Vous ne mettez pas les projets en pause vous-même : RAD met en pause un projet lié lorsque le solde acheté du client tombe en dessous du seuil, après leur avoir envoyé un e-mail, et le restaure lorsqu'ils rechargent.

**VAT Report** (Rapport de TVA). TVA collectée par client, par pays et par mois — TVA facturée moins TVA remboursée sur les remboursements — en crédits, chaque facturation au taux instantané au moment où elle a été effectuée, avec un chiffre en dollars américains à côté. Choisissez une plage de dates (**This month** (Ce mois-ci) et **Last month** (Le mois dernier) sont des raccourcis) et un pays, basculez entre **By customer** (Par client), **By country** (Par pays) et **By month** (Par mois), et utilisez **Export CSV** (Exporter au format CSV). Les mouvements d'entrée et de sortie d'un compte séquestre de laboratoire ou d'un portefeuille client sont exclus — la TVA est comptée lorsque ces crédits sont dépensés.

### Project Transactions (Transactions de projet) {#project-transactions}

Coûts des projets Google Cloud gérés par RAD de chaque client, tels qu'ils ont été facturés.

1. Allez dans **Billing** (Facturation) > **Project Transactions** (Transactions de projet). Il s'ouvre sur les 7 derniers jours.
2. Recherchez par ID de projet ou e-mail du propriétaire, ajustez les dates et cliquez sur **Search** (Rechercher).
3. Chaque ligne affiche le projet, son propriétaire et les crédits facturés. Chaque page de résultats est chargée, de sorte que les totaux et les exportations couvrent toute la période.

### Project Invoices (Factures de projet) {#project-invoices}

Rapprochez les dépenses réelles de Google Cloud.

1. Allez dans **Billing** (Facturation) > **Project Invoices** (Factures de projet). Il s'ouvre sur le mois en cours et le charge.
2. Choisissez un autre mois pour le modifier ; **Fetch Project Invoice** (Récupérer la facture de projet) recharge.
3. Chaque ligne affiche le nom et l'ID du projet, son propriétaire, le **list cost in credits** (coût catalogue en crédits) (le coût au taux de crédits par unité, avant toute marge de projet — ce n'est donc pas le montant débité) et le coût total dans votre devise d'affichage. Les totaux sous le tableau couvrent la page à l'écran et le disent. **Export to CSV** (Exporter au format CSV) exporte chaque projet pour ce mois.

Les **Module Costs** (Coûts des modules) par déploiement ne sont pas un onglet de facturation — ils se trouvent sur la page **Credits** (Crédits).

### Payout Summary (Récapitulatif des paiements) {#payout-summary}

Voir les totaux des paiements par bénéficiaire pour les partenaires et les agents. Cet onglet est disponible pour la **finance et l'administration uniquement**.

1. Allez dans **Billing** (Facturation) > **Payout Summary** (Récapitulatif des paiements). Il s'ouvre sur les 7 derniers jours et se charge immédiatement.
2. Pour rapporter sur une autre période, choisissez une date de début et une date de fin — les deux sont obligatoires, maximum 366 jours — puis cliquez sur **Calculate Payouts** (Calculer les paiements).
3. Chaque ligne affiche l'e-mail du bénéficiaire, s'il est payé en tant qu'agent, partenaire ou les deux, le nombre de transactions, les crédits achetés derrière elles, les **Setup Revenue** (Revenus de configuration) qu'un partenaire a gagnés en tant qu'ingénieur sur les demandes de configuration terminées, et le montant dû dans votre devise de facturation. Les chiffres des agents proviennent du grand livre des commissions, et le total basé sur les commissions compte chaque dépense une fois, même lorsqu'elle a payé à la fois un agent et un partenaire. Les totaux de période apparaissent sous le tableau, et **Export to CSV** (Exporter au format CSV) vous donne la même liste pour travailler.

#### Enregistrer un paiement partenaire {#recording-a-partner-payout}

RAD n'envoie pas d'argent — vous payez les partenaires en dehors de la plateforme — mais une fois que vous l'avez fait, enregistrez-le afin que vous et le partenaire ayez un enregistrement durable.

1. Sélectionnez la période couverte par le paiement. **La période doit être terminée** : **Mark paid** (Marquer comme payé) reste désactivé tant que la période inclut aujourd'hui, car tout ce qui est gagné après que vous l'ayez enregistré ne pourrait jamais être payé.
2. Sur la ligne du partenaire, entrez éventuellement votre référence de paiement, puis cliquez sur **Mark paid** (Marquer comme payé).
3. RAD recalcule le montant du partenaire pour cette période et **le stocke avec les taux en vigueur à ce moment-là**. Ce chiffre stocké est l'enregistrement permanent : si le taux de partage des revenus change plus tard, le chiffre en direct sur cette page bouge mais le paiement enregistré ne bouge pas, et la ligne affiche les deux lorsqu'ils diffèrent.

Une période peut être enregistrée une fois par partenaire ; marquer la même période à nouveau ne change rien, et une période qui chevauche une période déjà enregistrée pour ce partenaire est refusée. Chaque paiement enregistré écrit une entrée d'audit, et le partenaire le voit dans la section **Payouts** (Paiements) de son onglet **Module Revenue** (Revenus des modules). La commission d'agent a son propre flux de paiement sur **Agent Revenue** (Revenus des agents).

## Affichage des utilisateurs, agents et partenaires {#viewing-users-agents-and-partners}

En tant que Finance, vous pouvez voir tous les utilisateurs et les listes complètes d'agents et de partenaires.

- Voir et rechercher chaque compte sur **Billing** (Facturation) > **Credit Management** (Gestion des crédits) — le tableau liste tous les utilisateurs et a une boîte "Search by email" (Rechercher par e-mail). Il n'y a pas de page Utilisateurs séparée pour la Finance ; celle-ci est réservée aux administrateurs.
- Voir les partenaires et agents sur la plateforme via les sélecteurs sur **Module Revenue** (Revenus des modules), **Agent Revenue** (Revenus des agents) et le champ Assigned Engineer (Ingénieur assigné) sur les demandes de configuration.

### Limited user edits (Modifications limitées des utilisateurs) {#limited-user-edits}

La seule modification que vous pouvez apporter à un compte utilisateur concerne ses **soldes de crédits** (Awards, Subscription, Top-up et l'allocation mensuelle de partenaire), et jamais sur votre propre compte.

Tous les **rôles** — y compris l'octroi ou la révocation du rôle de **Partenaire** — et le statut **actif** d'un utilisateur sont **réservés aux administrateurs**, de sorte que l'écran de gestion des crédits ne vous montre aucun contrôle de rôle. Vous pouvez toujours définir l'allocation **Monthly Partner** (Partenaire mensuel) pour quelqu'un qui détient déjà le rôle de Partenaire.

## Labs (Laboratoires) {#labs}

La Finance supervise les sessions de laboratoire ; elle ne les exécute pas.

1. Cliquez sur **Labs** (Laboratoires) dans la barre de navigation (la même vue est **Solutions → Managed Environments** (Solutions → Environnements gérés)). Vous voyez les sessions de chaque formateur, avec une plage de dates, un filtre de statut et une colonne **Trainer** (Formateur).
2. Ouvrez **Participants** sur une session pour voir son règlement — engagé, consommé, remboursable, et tout ce qui est absorbé par RAD — et ses participants. **Export CSV** (Exporter au format CSV) télécharge la liste.
3. L'environnement de chaque participant ouvre une page de déploiement en lecture seule : statut de build et journaux, avec les secrets masqués. L'onglet **Outputs** (Sorties) et les mots de passe ou clés générés ne vous sont pas affichés ; ils appartiennent au participant et au formateur.

La seule modification que vous pouvez apporter est **End now** (Terminer maintenant), qui arrête immédiatement les dépenses d'une session. Cela ne déplace pas d'argent : le compte séquestre est réglé plus tard, une fois que l'utilisation de Google Cloud de la session a été mesurée. Tout le reste — créer ou dupliquer des sessions, démarrer des horloges, prolonger, ajouter ou supprimer des participants, renvoyer des invitations, provisionner et recharger — appartient au formateur de la session ou à un administrateur, et ces contrôles ne vous sont pas affichés.

## Setup Requests (Demandes de configuration) {#setup-requests}

Les demandes de configuration gérées des utilisateurs qui souhaitent que RAD gère un déploiement pour eux apparaissent ici.

1. Cliquez sur **Help** (Aide) dans la barre de navigation, puis ouvrez l'onglet **Setup Requests** (Demandes de configuration).
2. L'onglet s'ouvre sur les 7 derniers jours et se charge immédiatement. Pour le modifier, choisissez un filtre de statut et une date de début et de fin, puis cliquez sur **Load Requests** (Charger les demandes).
3. Développez une demande pour la traiter : définissez son **status** (statut) (nouveau, en cours, terminé ou annulé), choisissez un **Assigned Engineer** (Ingénieur assigné) (seuls les partenaires enregistrés sont acceptés), enregistrez les **Revenue Achieved** (Revenus réalisés) et ajoutez des notes internes. Cliquez sur **Save** (Enregistrer) pour appliquer.
4. L'enregistrement d'une demande comme *terminée* est ce qui calcule la répartition entre les revenus de la plateforme et de l'ingénieur, alors définissez le chiffre des revenus avant de la marquer comme terminée. L'ingénieur conserve **75 %** et la plateforme **25 %** par défaut ; un administrateur peut définir une part de plateforme différente (**Platform revenue share (setup requests)** (Part de revenus de la plateforme (demandes de configuration)) dans les paramètres), et une part de 0 est honorée. La **Partner Revenue Share** (Part de revenus du partenaire) du module n'affecte pas les demandes de configuration. La modification des revenus sur une demande déjà terminée recalcule la répartition sans modifier sa date de fin. **Export to CSV** (Exporter au format CSV) vous donne l'ensemble chargé pour le rapport.

## Audit Log (Journal d'audit) {#audit-log}

Ouvrez **Audit Log** (Journal d'audit) depuis la barre de navigation pour voir qui a modifié quoi, et quand, sur l'argent de la plateforme. Votre vue affiche uniquement les actions liées à l'argent : modifications du solde de crédits et ajustements en masse, récompenses de parrainage, annulations de commissions d'agent et paiements, répartitions des revenus des demandes de configuration, codes d'événement, frais de session de laboratoire, remboursements et règlements — y compris un endroit payé par un formateur au nom d'un participant (avec la note du formateur sur le paiement hors ligne, s'il en a laissé une) — et modifications de la facturation client et demandes de projets liés, approbations, rejets, pauses et dissociations. Les administrateurs voient toutes les actions.

- La page s'ouvre sur les 7 derniers jours. Modifiez les dates, choisissez une **Action**, ou tapez une partie d'un e-mail dans **Performed by** (Effectué par), puis sélectionnez **Load** (Charger). La plage peut aller jusqu'à un an.
- Sélectionnez **Show all** (Tout afficher) sur une ligne pour voir tout ce qui y est enregistré, comme le solde avant et après une modification.
- Les résultats sont paginés sous le tableau ; choisissez 25, 50, 100 ou 200 lignes par page.
- Si une plage contient plus d'actions qu'un chargement ne peut en lire, seules les plus récentes sont affichées et un avis vous demande de réduire les dates.

Le journal est en lecture seule.

## Obtenir de l'aide {#getting-help}

Cliquez sur **Help** (Aide) dans la barre de navigation :

- Onglet **Send Message** (Envoyer un message) — un formulaire de contact qui crée un ticket de support et envoie un e-mail à l'équipe de support. L'onglet **My Tickets** (Mes tickets) à côté liste les tickets que vous avez créés et leur statut. Lorsque les achats sont activés, la création d'un ticket nécessite des crédits achetés sur votre compte ; si les achats sont désactivés, n'importe qui peut en créer un. Chaque compte peut créer jusqu'à 5 tickets sur 24 heures.
- Onglet **Setup Requests** (Demandes de configuration) — décrit ci-dessus.
- Onglet **Support Tickets** (Tickets de support) — la file d'attente partagée des tickets. Comme la facturation est l'une de ses catégories, vous pouvez la trier : la Finance et les administrateurs peuvent attribuer, réaffecter ou effacer l'affectation d'un ticket à n'importe qui, tandis que les agents de support ne peuvent que réclamer un ticket non attribué ou libérer un ticket qu'ils détiennent.

Le calculateur de **ROI** ne se trouve pas sur l'aide — c'est le dernier onglet de la page **Credits** (Crédits), **Calculate ROI** (Calculer le ROI). Les crédits n'apparaissent dans votre navigation que si votre compte détient également le rôle d'utilisateur ordinaire ; sinon, allez directement à `/credits`. Sans le rôle d'utilisateur, vous n'avez pas votre propre grand livre de crédits, donc la page n'offre pas de **Credit Transactions** (Transactions de crédit) et s'ouvre sur **Module Revenue** (Revenus des modules) à la place ; **Module Costs** (Coûts des modules) et **Project Invoices** (Factures de projet) sont là comme d'habitude.

Un lien **Contact Us** (Nous contacter) dans le pied de page vous amène également à la page d'aide.
