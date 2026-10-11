import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FundingService } from './funding.service';
import { FundingStatus } from '../common/enums';

// Any valid 24-hex ObjectId; only passed around, never queried against.
const USER_ID = '507f1f77bcf86cd799439011';
const ADMIN_ID = '507f1f77bcf86cd799439012';

function fundingDoc(overrides: Record<string, any> = {}) {
  return {
    _id: 'funding_1',
    user: USER_ID,
    amount: 10000,
    reference: 'FND-ABC123',
    status: FundingStatus.PENDING,
    provider: 'cashback',
    cashbackAmount: undefined,
    transferReference: undefined,
    save: jest.fn().mockImplementation(function (this: Record<string, any>) {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

describe('FundingService — cashback funding bonus', () => {
  const fundingModel = { findById: jest.fn(), findOne: jest.fn(), create: jest.fn() };
  const userModel = { findById: jest.fn() };
  const cashbackConfigModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const connection = { startSession: jest.fn() };
  const walletService = { credit: jest.fn().mockResolvedValue({}), creditCashback: jest.fn().mockResolvedValue({}) };
  const gateways = { resolve: jest.fn(), get: jest.fn() };
  const dedicatedAccounts = {};
  let service: FundingService;

  /** `getCashbackConfig()` resolves `findOne().sort().lean()` to `doc`. */
  const withConfigDoc = (doc: any) => {
    cashbackConfigModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) }),
    });
  };
  /** `getCashbackConfig()` resolves to no stored document (bonus disabled). */
  const withNoConfigDoc = () => withConfigDoc(null);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FundingService(
      fundingModel as any,
      userModel as any,
      cashbackConfigModel as any,
      connection as any,
      walletService as any,
      gateways as any,
      dedicatedAccounts as any,
    );
  });
describe('getCashbackConfig', () => {
    it('returns 0 when no config document exists', async () => {
      withNoConfigDoc();
      await expect(service.getCashbackConfig()).resolves.toEqual({ percentage: 0 });
    });

    it('returns the stored percentage', async () => {
      withConfigDoc({ percentage: 2.5 });
      await expect(service.getCashbackConfig()).resolves.toEqual({ percentage: 2.5 });
    });
  });

  describe('setCashbackConfig', () => {
    it('upserts the percentage and records the admin', async () => {
      cashbackConfigModel.findOneAndUpdate.mockResolvedValue({ percentage: 2 });

      await service.setCashbackConfig(ADMIN_ID, 2);

      expect(cashbackConfigModel.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        {
          $set: { percentage: 2, updatedBy: expect.any(Object) },
        },
        { upsert: true, new: true },
      );
    });

    it('clamps out-of-range values to 0–100', async () => {
      cashbackConfigModel.findOneAndUpdate.mockResolvedValue({});

      await service.setCashbackConfig(ADMIN_ID, -5);
      expect(cashbackConfigModel.findOneAndUpdate.mock.calls[0][1].$set.percentage).toBe(0);

      await service.setCashbackConfig(ADMIN_ID, 150);
      expect(cashbackConfigModel.findOneAndUpdate.mock.calls[1][1].$set.percentage).toBe(100);
    });

    it('rounds the percentage to 2 decimals', async () => {
      cashbackConfigModel.findOneAndUpdate.mockResolvedValue({});

      await service.setCashbackConfig(ADMIN_ID, 2.346);
      expect(cashbackConfigModel.findOneAndUpdate.mock.calls[0][1].$set.percentage).toBe(2.35);
    });
  });
describe('createDeposit — cashback transfer reference', () => {
    it('rejects cashback funding without a transfer reference (before creating anything)', async () => {
      userModel.findById.mockResolvedValue({ name: 'Ada', email: 'ada@example.com' });

      await expect(
        service.createDeposit(USER_ID, 5000, undefined, 'cashback', '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fundingModel.create).not.toHaveBeenCalled();
    });

    it('stores the trimmed transfer reference on the cashback funding request', async () => {
      const funding = fundingDoc();
      userModel.findById.mockResolvedValue({ name: 'Ada', email: 'ada@example.com' });
      fundingModel.create.mockResolvedValue(funding);

      const result = await service.createDeposit(USER_ID, 5000, undefined, 'cashback', '  TXN-12345  ');

      expect(funding.transferReference).toBe('TXN-12345');
      expect(funding.provider).toBe('cashback');
      expect(funding.save).toHaveBeenCalled();
      expect(result.checkoutUrl).toBeNull();
    });
  });

  describe('approve — cashback bonus', () => {
    it('credits the wallet and adds the configured cashback bonus for cashback funding', async () => {
      const funding = fundingDoc({ amount: 10000 });
      fundingModel.findById.mockResolvedValue(funding);
      withConfigDoc({ percentage: 2 });

      const result = await service.approve('funding_1', ADMIN_ID);

      expect(funding.cashbackAmount).toBe(200);
      expect(funding.status).toBe(FundingStatus.CREDITED);
      expect(funding.save).toHaveBeenCalled();
      expect(walletService.credit).toHaveBeenCalledWith(
        USER_ID,
        10000,
        'Wallet funding (FND-ABC123)',
      );
      expect(walletService.creditCashback).toHaveBeenCalledWith(
        USER_ID,
        200,
        'Cashback funding bonus (FND-ABC123)',
      );
      expect(result).toBe(funding);
    });

    it('rounds the bonus amount to 2 decimals', async () => {
      const funding = fundingDoc({ amount: 333 });
      fundingModel.findById.mockResolvedValue(funding);
      withConfigDoc({ percentage: 2.5 });

      await service.approve('funding_1', ADMIN_ID);

      expect(funding.cashbackAmount).toBe(8.33);
      expect(walletService.creditCashback).toHaveBeenCalledWith(USER_ID, 8.33, expect.any(String));
    });

    it('credits no bonus when the configured percentage is 0', async () => {
      const funding = fundingDoc({ amount: 10000 });
      fundingModel.findById.mockResolvedValue(funding);
      withConfigDoc({ percentage: 0 });

      await service.approve('funding_1', ADMIN_ID);

      expect(funding.cashbackAmount).toBeUndefined();
      expect(walletService.credit).toHaveBeenCalled();
      expect(walletService.creditCashback).not.toHaveBeenCalled();
    });

    it('credits no bonus when no config document exists', async () => {
      const funding = fundingDoc({ amount: 10000 });
      fundingModel.findById.mockResolvedValue(funding);
      withNoConfigDoc();

      await service.approve('funding_1', ADMIN_ID);

      expect(funding.cashbackAmount).toBeUndefined();
      expect(walletService.creditCashback).not.toHaveBeenCalled();
    });

    it('never pays the bonus for non-cashback funding even with a configured rate', async () => {
      const funding = fundingDoc({ amount: 10000, provider: 'manual' });
      fundingModel.findById.mockResolvedValue(funding);
      withConfigDoc({ percentage: 10 });

      await service.approve('funding_1', ADMIN_ID);

      expect(funding.cashbackAmount).toBeUndefined();
      expect(walletService.creditCashback).not.toHaveBeenCalled();
    });

    it('throws NotFound when the request does not exist', async () => {
      fundingModel.findById.mockResolvedValue(null);

      await expect(service.approve('funding_1', ADMIN_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(walletService.creditCashback).not.toHaveBeenCalled();
    });

    it('throws BadRequest when the request was already processed', async () => {
      fundingModel.findById.mockResolvedValue(fundingDoc({ status: FundingStatus.CREDITED }));

      await expect(service.approve('funding_1', ADMIN_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(walletService.credit).not.toHaveBeenCalled();
      expect(walletService.creditCashback).not.toHaveBeenCalled();
    });
  });
});