import { TransactionsService } from './transactions.service';
import { PaymentWallet, TransactionStatus } from '../common/enums';

describe('TransactionsService — settle & cashback', () => {
  let service: TransactionsService;
  let transactionModel: any;
  let fundingModel: any;
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
    fundingModel = { find: jest.fn(), countDocuments: jest.fn() };
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
      fundingModel,
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

describe('TransactionsService — history feed merges funding', () => {
  let service: TransactionsService;
  let transactionModel: any;
  let fundingModel: any;
  let walletService: any;
  let vendorService: any;
  let usersService: any;
  let connection: any;
  const USER_ID = '507f1f77bcf86cd799439011';

  /** Makes `model.find(...).sort(...).limit(n)` resolve to `result`. */
  function mockFind(model: any, result: any[]) {
    model.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(result) }),
    });
  }

  const txnDoc = (id: string, createdAt: string, service = 'DATA') => ({
    _id: id,
    user: USER_ID,
    service,
    reference: `VTU-${id}`,
    amount: 1000,
    commission: 0,
    status: 'success',
    createdAt: new Date(createdAt),
  });

  const fundingDoc = (id: string, createdAt: string) => ({
    _id: id,
    user: USER_ID,
    amount: 10000,
    reference: `FND-${id}`,
    status: 'credited',
    provider: 'cashback',
    createdAt: new Date(createdAt),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    transactionModel = { find: jest.fn(), countDocuments: jest.fn(), create: jest.fn(), findOneAndUpdate: jest.fn() };
    fundingModel = { find: jest.fn(), countDocuments: jest.fn(), create: jest.fn() };
    walletService = {};
    vendorService = {};
    usersService = {};
    connection = { startSession: jest.fn() };
    service = new TransactionsService(
      transactionModel,
      fundingModel,
      walletService,
      vendorService,
      usersService,
      connection,
    );
  });

  it('interleaves funding requests with purchases, newest first', async () => {
    mockFind(transactionModel, [
      txnDoc('txn-new', '2026-10-03T10:00:00Z'),
      txnDoc('txn-old', '2026-10-01T10:00:00Z'),
    ]);
    transactionModel.countDocuments.mockResolvedValue(2);
    mockFind(fundingModel, [fundingDoc('fund-1', '2026-10-02T10:00:00Z')]);
    fundingModel.countDocuments.mockResolvedValue(1);

    const result = await service.myTransactions(USER_ID, { page: 1, limit: 15 });

    expect(result.total).toBe(3);
    expect(result.items.map((i: any) => i._id)).toEqual(['txn-new', 'fund-1', 'txn-old']);
  });

  it('keeps funding out of the feed when a service filter is active', async () => {
    mockFind(transactionModel, [txnDoc('txn-1', '2026-10-03T10:00:00Z', 'AIRTIME')]);
    transactionModel.countDocuments.mockResolvedValue(1);

    const result = await service.myTransactions(USER_ID, { page: 1, limit: 15, service: 'AIRTIME' as any });

    expect(fundingModel.find).not.toHaveBeenCalled();
    expect(fundingModel.countDocuments).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items.map((i: any) => i._id)).toEqual(['txn-1']);
  });

  it('slices later pages from the merged, sorted feed', async () => {
    mockFind(transactionModel, [
      txnDoc('txn-1', '2026-10-05T10:00:00Z'),
      txnDoc('txn-2', '2026-10-03T10:00:00Z'),
    ]);
    transactionModel.countDocuments.mockResolvedValue(2);
    mockFind(fundingModel, [
      fundingDoc('fund-1', '2026-10-06T10:00:00Z'),
      fundingDoc('fund-2', '2026-10-04T10:00:00Z'),
    ]);
    fundingModel.countDocuments.mockResolvedValue(2);

    // Page 2 of limit 1 = the second-newest entry across both collections.
    const result = await service.myTransactions(USER_ID, { page: 2, limit: 1 });

    expect(result.total).toBe(4);
    expect(result.items.map((i: any) => i._id)).toEqual(['txn-1']);
  });
});