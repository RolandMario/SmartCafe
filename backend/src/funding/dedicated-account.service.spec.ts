import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { DedicatedAccountService } from './dedicated-account.service';
import { FundingStatus } from '../common/enums';

// Any valid 24-hex ObjectId; only passed around, never queried against.
const UID = '507f1f77bcf86cd799439011';

/** Minimal document stub with the bits toView/save touch. */
function doc(overrides: Record<string, any>) {
  return {
    _id: { toString: () => 'dva_id_1' },
    status: 'pending',
    accountNumber: undefined,
    accountName: undefined,
    bankName: undefined,
    customerCode: 'CUS_abc',
    provider: 'paystack',
    createdAt: undefined,
    providerMeta: undefined,
    processedAt: undefined,
    save: jest.fn(),
    ...overrides,
  };
}

describe('DedicatedAccountService — Paystack DVA', () => {
  const model = { findOne: jest.fn(), create: jest.fn() };
  const userModel = { findById: jest.fn() };
  const fundingModel = { findOne: jest.fn(), create: jest.fn() };
  const connection = { startSession: jest.fn() };
  const paystack = {
    isConfigured: jest.fn(() => true),
    getOrCreateCustomer: jest.fn(),
    createDedicatedAccount: jest.fn(),
    listCustomerDedicatedAccounts: jest.fn(),
    requeryDedicatedAccount: jest.fn(),
  };
  const walletService = { credit: jest.fn() };
  let service: DedicatedAccountService;

  function user() {
    return { lean: jest.fn().mockResolvedValue({ name: 'Ada Lovelace', email: 'ada@x.io', phone: '08000000000' }) };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DedicatedAccountService(
      model as any,
      userModel as any,
      fundingModel as any,
      connection as any,
      paystack as any,
      walletService as any,
    );
  });

  describe('getOrCreate — first creation', () => {
    beforeEach(() => {
      model.findOne.mockResolvedValue(null); // no existing DVA
      userModel.findById.mockReturnValue(user());
    });

    it('creates a customer, creates the DVA and stores a synchronous assignment as active', async () => {
      paystack.getOrCreateCustomer.mockResolvedValue({ customerCode: 'CUS_abc' });
      paystack.createDedicatedAccount.mockResolvedValue({
        assigned: true,
        account_number: '0123456789',
        account_name: 'Ada Lovelace',
        bank: { name: 'Test Bank', slug: 'test-bank' },
        id: 44,
      });
      const created = doc({ status: 'active', accountNumber: '0123456789' });
      model.create.mockResolvedValue(created);

      const view = await service.getOrCreate(UID);

      expect(paystack.getOrCreateCustomer).toHaveBeenCalledWith({
        email: 'ada@x.io',
        name: 'Ada Lovelace',
        phone: '08000000000',
      });
      expect(paystack.createDedicatedAccount).toHaveBeenCalledWith({
        customerCode: 'CUS_abc',
      });
      const payload = model.create.mock.calls[0][0];
      expect(payload.status).toBe('active');
      expect(payload.accountNumber).toBe('0123456789');
      expect(payload.customerCode).toBe('CUS_abc');
      expect(payload.processedAt).toBeInstanceOf(Date);
      expect(view.status).toBe('active');
      expect(view.accountNumber).toBe('0123456789');
    });

    it('stores an asynchronous assignment (provisioning) as pending without a number', async () => {
      paystack.getOrCreateCustomer.mockResolvedValue({ customerCode: 'CUS_abc' });
      paystack.createDedicatedAccount.mockResolvedValue({
        assigned: false,
        account_number: undefined,
        assignment: { status: 'provisioning', integration: 8 },
      });
      const created = doc({ status: 'pending' });
      model.create.mockResolvedValue(created);

      const view = await service.getOrCreate(UID);

      const payload = model.create.mock.calls[0][0];
      expect(payload.status).toBe('pending');
      expect(payload.accountNumber).toBeUndefined();
      expect(payload.processedAt).toBeUndefined();
      expect(view.status).toBe('pending');
    });

    it('falls back to reusing the live DVA when Paystack reports a duplicate customer', async () => {
      paystack.getOrCreateCustomer.mockResolvedValue({ customerCode: 'CUS_abc' });
      paystack.createDedicatedAccount.mockRejectedValue(
        new BadGatewayException('Paystack request failed: Customer already has a dedicated account'),
      );
      paystack.listCustomerDedicatedAccounts.mockResolvedValue([
        { assigned: true, account_number: '9876543210', bank: { name: 'Wema Bank' } },
      ]);
      const created = doc({ status: 'active', accountNumber: '9876543210' });
      model.create.mockResolvedValue(created);

      const view = await service.getOrCreate(UID);

      expect(paystack.listCustomerDedicatedAccounts).toHaveBeenCalledWith('CUS_abc');
      expect(model.create.mock.calls[0][0].accountNumber).toBe('9876543210');
      expect(view.accountNumber).toBe('9876543210');
    });

    it('throws when Paystack is not configured', async () => {
      paystack.isConfigured.mockReturnValue(false);
      await expect(service.getOrCreate(UID)).rejects.toBeInstanceOf(BadGatewayException);
      expect(paystack.getOrCreateCustomer).not.toHaveBeenCalled();
    });

    it('throws NotFound when the user is gone', async () => {
      paystack.isConfigured.mockReturnValue(true); // undo the toggle set by the test above
      userModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.getOrCreate(UID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOrCreate — existing account', () => {
    it('returns the stored account without calling the provider', async () => {
      const existing = doc({ status: 'active', accountNumber: '0123456789' });
      model.findOne.mockResolvedValue(existing);

      const view = await service.getOrCreate(UID);

      expect(paystack.getOrCreateCustomer).not.toHaveBeenCalled();
      expect(paystack.createDedicatedAccount).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
      expect(view).toBeDefined();
    });
  });

  describe('getByUser — pending finalization', () => {
    it('requeries an async assignment and promotes the row to active', async () => {
      const pending = doc({
        status: 'pending',
        customerCode: 'CUS_abc',
        save: jest.fn().mockResolvedValue(undefined),
      });
      model.findOne.mockResolvedValue(pending);
      paystack.requeryDedicatedAccount.mockResolvedValue({
        assigned: true,
        account_number: '5550012345',
        account_name: 'Ada Lovelace',
        bank: { name: 'Wema Bank' },
      });

      const result = await service.getByUser(UID);

      expect(paystack.requeryDedicatedAccount).toHaveBeenCalledWith({
        customerCode: 'CUS_abc',
      });
      expect(result?.status).toBe('active');
      expect(result?.accountNumber).toBe('5550012345');
      expect(pending.save).toHaveBeenCalled();
    });

    it('keeps the row pending when requery finds nothing yet', async () => {
      const pending = doc({ status: 'pending', save: jest.fn() });
      model.findOne.mockResolvedValue(pending);
      paystack.requeryDedicatedAccount.mockResolvedValue({ assigned: false });

      const result = await service.getByUser(UID);

      expect(result?.status).toBe('pending');
      expect(pending.save).not.toHaveBeenCalled();
    });

    it('never requeries an already active account', async () => {
      const active = doc({ status: 'active', accountNumber: '0123456789' });
      model.findOne.mockResolvedValue(active);

      await service.getByUser(UID);

      expect(paystack.requeryDedicatedAccount).not.toHaveBeenCalled();
    });
  });

  describe('handleAssignmentWebhook', () => {
    it('finalizes a pending row on dedicatedaccount.assign.success', async () => {
      const pending = doc({
        status: 'pending',
        customerCode: 'CUS_abc',
        save: jest.fn().mockResolvedValue(undefined),
      });
      model.findOne.mockResolvedValue(pending);

      await service.handleAssignmentWebhook({
        event: 'dedicatedaccount.assign.success',
        data: {
          customer_code: 'CUS_abc',
          account_number: '7770001234',
          account_name: 'Ada Lovelace',
          bank: { name: 'Test Bank' },
        },
      });

      expect(pending.status).toBe('active');
      expect(pending.accountNumber).toBe('7770001234');
      expect(pending.save).toHaveBeenCalled();
    });

    it('marks the row failed on dedicatedaccount.assign.failed', async () => {
      const pending = doc({
        status: 'pending',
        customerCode: 'CUS_abc',
        save: jest.fn().mockResolvedValue(undefined),
      });
      model.findOne.mockResolvedValue(pending);

      await service.handleAssignmentWebhook({
        event: 'dedicatedaccount.assign.failed',
        data: { customer_code: 'CUS_abc' },
      });

      expect(pending.status).toBe('failed');
      expect(pending.save).toHaveBeenCalled();
    });

    it('ignores webhooks for unknown customers', async () => {
      model.findOne.mockResolvedValue(null);
      await service.handleAssignmentWebhook({
        event: 'dedicatedaccount.assign.success',
        data: { customer_code: 'CUS_unknown', account_number: '1' },
      });
      // No row matched → nothing saved/created.
      expect(model.findOne).toHaveBeenCalledWith({ customerCode: 'CUS_unknown' });
      expect(model.create).not.toHaveBeenCalled();
    });
  });
  describe('handleCreditWebhook — DVA deposits auto-credit the wallet', () => {
    /** A realistic Paystack `charge.success` receipt for a DVA transfer. */
    function dvaDeposit(overrides: Record<string, any> = {}) {
      return {
        event: 'charge.success',
        data: {
          channel: 'dedicated_nuban',
          reference: '2143762048',
          amount: 500000,
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_abc',
            email: 'ada@x.io',
            first_name: 'Ada',
            last_name: 'Lovelace',
          },
          authorization: {
            channel: 'dedicated_nuban',
            receiver_bank_account_number: '8123456789',
          },
          ...overrides,
        },
      };
    }

    function fakeSession() {
      return {
        withTransaction: jest.fn(async (cb: () => Promise<void>) => cb()),
        endSession: jest.fn().mockResolvedValue(undefined),
      };
    }

    function matchedDva() {
      return doc({
        status: 'active',
        accountNumber: '8123456789',
        user: UID,
        bankName: 'Wema Bank',
        save: jest.fn().mockResolvedValue(undefined),
      });
    }

    it('detects DVA receipts via data.channel or authorization.channel only', () => {
      expect(DedicatedAccountService.isDvaCreditEvent(dvaDeposit())).toBe(true);
      expect(
        DedicatedAccountService.isDvaCreditEvent(
          dvaDeposit({
            channel: undefined,
            authorization: { channel: 'dedicated_nuban' },
          }),
        ),
      ).toBe(true);
      expect(
        DedicatedAccountService.isDvaCreditEvent(dvaDeposit({ channel: 'card' })),
      ).toBe(false);
      expect(
        DedicatedAccountService.isDvaCreditEvent(
          dvaDeposit({ channel: 'bank_transfer' }),
        ),
      ).toBe(false);
      expect(
        DedicatedAccountService.isDvaCreditEvent({
          event: 'dedicatedaccount.assign.success',
          data: { channel: 'dedicated_nuban' },
        }),
      ).toBe(false);
      expect(
        DedicatedAccountService.isDvaCreditEvent({
          event: 'charge.success',
          data: {},
        }),
      ).toBe(false);
    });

    it('credits the wallet and records a credited funding row for a matched customer', async () => {
      const dva = matchedDva();
      model.findOne.mockResolvedValue(dva);
      // First delivery → no funding row yet. Chainable query (has .session()).
      fundingModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      connection.startSession.mockResolvedValue(fakeSession());
      fundingModel.create.mockResolvedValue([{}]);
      walletService.credit.mockResolvedValue({});

      await service.handleCreditWebhook(dvaDeposit());

      expect(model.findOne).toHaveBeenCalledWith({
        $or: [{ customerCode: 'CUS_abc' }, { accountNumber: '8123456789' }],
      });
      const funding = fundingModel.create.mock.calls[0][0][0];
      expect(funding.paymentReference).toBe('2143762048');
      expect(funding.reference).toBe('DVA-2143762048');
      expect(funding.amount).toBe(5000); // kobo → naira
      expect(funding.status).toBe(FundingStatus.CREDITED);
      expect(funding.provider).toBe('paystack');
      expect(funding.method).toBe('Bank transfer (DVA)');
      expect(walletService.credit).toHaveBeenCalledWith(
        UID,
        5000,
        'Wallet funding (2143762048)',
        undefined,
        expect.anything(), // the Mongoose session
      );
      expect((dva as any).providerMeta?.latestDeposit?.reference).toBe('2143762048');
      expect(dva.save).toHaveBeenCalled();
    });

    it('is idempotent — a retry with the same reference never double-credits', async () => {
      const dva = matchedDva();
      model.findOne.mockResolvedValue(dva);
      // Second delivery → the funding row now exists as credited.
      fundingModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue({ status: FundingStatus.CREDITED }),
      });
      connection.startSession.mockResolvedValue(fakeSession());
      fundingModel.create.mockResolvedValue([{}]);
      walletService.credit.mockResolvedValue({});

      await service.handleCreditWebhook(dvaDeposit());
      await service.handleCreditWebhook(dvaDeposit());

      expect(fundingModel.create).not.toHaveBeenCalled();
      expect(walletService.credit).not.toHaveBeenCalled();
    });

    it('ignores deposits that match no DVA row', async () => {
      model.findOne.mockResolvedValue(null);

      await service.handleCreditWebhook(dvaDeposit());

      expect(fundingModel.create).not.toHaveBeenCalled();
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('falls back to matching by account number when customer code is absent', async () => {
      model.findOne.mockResolvedValue(matchedDva());
      fundingModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });
      connection.startSession.mockResolvedValue(fakeSession());
      fundingModel.create.mockResolvedValue([{}]);
      walletService.credit.mockResolvedValue({});

      await service.handleCreditWebhook(
        dvaDeposit({
          customer: undefined,
          authorization: { receiver_bank_account_number: '8123456789' },
        }),
      );

      expect(model.findOne).toHaveBeenCalledWith({ accountNumber: '8123456789' });
      expect(walletService.credit).toHaveBeenCalled();
    });

    it('ignores malformed receipts (missing reference/amount, non-numeric, non-NGN)', async () => {
      await service.handleCreditWebhook(dvaDeposit({ reference: undefined }));
      await service.handleCreditWebhook(dvaDeposit({ amount: undefined }));
      await service.handleCreditWebhook(dvaDeposit({ amount: 'abc' }));
      await service.handleCreditWebhook(dvaDeposit({ amount: -100 }));
      await service.handleCreditWebhook(dvaDeposit({ currency: 'USD' }));

      expect(model.findOne).not.toHaveBeenCalled();
      expect(connection.startSession).not.toHaveBeenCalled();
      expect(fundingModel.create).not.toHaveBeenCalled();
      expect(walletService.credit).not.toHaveBeenCalled();
    });
  });

});