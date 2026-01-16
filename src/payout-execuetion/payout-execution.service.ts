// @Injectable()
// export class PayoutExecutionService {
//   constructor(
//     @InjectRepository(Payout)
//     private payoutRepo: Repository<Payout>,

//     private bankProvider: BankProvider,
//     private walletProvider: WalletProvider,
//   ) {}

//   // Execute Single Payout (CORE LOGIC)

//   async executePayout(payout: Payout) {
//   if (payout.status !== PayoutStatus.PENDING) return;

//   try {
//     let reference: string;

//     if (payout.method === PayoutMethod.BANK) {
//       const result = await this.bankProvider.send(
//         payout.user.iban,
//         payout.amount,
//       );
//       reference = result.reference;
//     }

//     if (payout.method === PayoutMethod.WALLET) {
//       const result = await this.walletProvider.send(
//         payout.user.walletAddress,
//         payout.amount,
//       );
//       reference = result.txHash;
//     }

//     payout.status = PayoutStatus.PAID;
//     payout.transactionReference = reference;

//   } catch (err) {
//     payout.failureReason = err.message;
//   }

//   await this.payoutRepo.save(payout);
// }

// //STEP 6: CRON JOB (SAFE & CONTROLLED)

// @Cron(CronExpression.EVERY_HOUR)
// async processPayouts() {
//   const payouts = await this.payoutRepo.find({
//     where: { status: PayoutStatus.PENDING },
//   });

//   for (const payout of payouts) {
//     await this.payoutExecutionService.executePayout(payout);
//   }
// }
