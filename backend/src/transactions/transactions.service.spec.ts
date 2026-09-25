import { TransactionsService } from './transactions.service';
import { PaymentWallet, TransactionStatus } from '../common/enums';

describe('TransactionsService — settle & cashback', () => {
  let service: TransactionsService;
  let transactionModel: any;
  let walletService: any;
  let vendorService: any;
  let usersService: any;
  let connection: any;

  function makeTransaction(overrides: Record<string, any> = {}): any {
    return {
      _id: 'txn1',
      user: { toString: () => 'u1' },
      service: 'DATA',
      reference: 'VTU123',
      amount: 1000,
      commission: 0,
      paymentWallet: PaymentWallet.MAIN,
      cashback: 0,
      cashbackCredited: false,
      status: TransactionStatus.PENDING,
      save: jest.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    transactionModel = { create: jest.fn(), findOneAndUpdate: jest.fn() };
    walletService = {
      debit: jest.fn(),
      debitCashback: jest.fn(),
      credit: jest.fn(),
      creditCashback: jest.fn(),
    };
    vendorService = {};
    usersService = {};
    const session = {
      withTransaction: jest.fn(async (cb: () => void) => cb()),
      endSession: jest.fn(async () => {}),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    service = new TransactionsService(
      transactionModel,
      walletService,
      vendorService,
      usersService,
      connection,
    );
  });

  it('credits cashback on success and marks cashbackCredited', async () => {
    const txn = makeTransaction({ cashback: 200 });
    transactionModel.findOneAndUpdate.mockResolvedValue({ _id: 'txn1' });

    const result = await service.settle(txn, { status: 'success' as const });

    expect(result.status).toBe(TransactionStatus.SUCCESS);
    expect(txn.status).toBe(TransactionStatus.SUCCESS);
    expect(txn.cashbackCredited).toBe(true);
    // The conditional update is the once-only guard against double crediting.
    expect(transactionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'txn1', cashbackCredited: { $ne: true } },
      expect.anything(),
      expect.anything(),
    );
    expect(walletService.creditCashback).toHaveBeenCalledWith(
      'u1',
      200,
      expect.stringContaining('Cashback earned'),
      'txn1',
      expect.anything(),
    );
  });

  it('does not credit cashback when the product earns none', async () => {
    const txn = makeTransaction({ cashback: 0 });
    transactionModel.findOneAndUpdate.mockResolvedValue({ _id: 'txn1' });

    await service.settle(txn, { status: 'success' as const });

    expect(txn.status).toBe(TransactionStatus.SUCCESS);
    expect(walletService.creditCashback).not.toHaveBeenCalled();
  });

  it('never double-credits when a racing requery already settled', async () => {
    const txn = makeTransaction({ cashback: 200 });
    // The conditional update finds nothing: another requery already claimed it.
    transactionModel.findOneAndUpdate.mockResolvedValue(null);

    await service.settle(txn, { status: 'success' as const });

    expect(txn.status).toBe(TransactionStatus.SUCCESS);
    expect(walletService.creditCashback).not.toHaveBeenCalled();
  });

  it('refunds failed purchases to the source (main) wallet', async () => {
    const txn = makeTransaction();

    const result = await service.settle(txn, {
      status: 'failed' as const,
      message: 'Vendor error',
    });

    expect(result.status).toBe(TransactionStatus.FAILED);
    expect(txn.status).toBe(TransactionStatus.FAILED);
    expect(walletService.credit).toHaveBeenCalledWith(
      'u1',
      1000,
      expect.stringContaining('Refund'),
      'txn1',
    );
    expect(walletService.creditCashback).not.toHaveBeenCalled();
  });

  it('refunds failed cashback-funded purchases back to the cashback wallet', async () => {
    const txn = makeTransaction({ paymentWallet: PaymentWallet.CASHBACK });

    await service.settle(txn, { status: 'failed' as const, message: 'Vendor error' });

    expect(walletService.creditCashback).toHaveBeenCalledWith(
      'u1',
      1000,
      expect.stringContaining('Refund'),
      'txn1',
    );
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it('leaves funds untouched while the vendor result is pending', async () => {
    const txn = makeTransaction();

    const result = await service.settle(txn, { status: 'pending' as const });

    expect(result.status).toBe(TransactionStatus.PENDING);
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(walletService.creditCashback).not.toHaveBeenCalled();
    expect(transactionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});