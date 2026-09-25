import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PaymentWallet } from '../common/enums';

// Any valid 24-hex ObjectId; only passed around, never queried against.
const UID = '507f1f77bcf86cd799439011';

describe('WalletService — cashback wallet', () => {
  const walletModel = { findOneAndUpdate: jest.fn(), findOne: jest.fn(), create: jest.fn() };
  const ledgerModel = { create: jest.fn() };
  const connection = { startSession: jest.fn() };
  let service: WalletService;

  /** Returns the query builder shaped object wallet.service chains .session() on. */
  function resolvedWallet(doc: any) {
    return { session: jest.fn().mockResolvedValue(doc) };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WalletService(walletModel as any, ledgerModel as any, connection as any);
  });

  describe('creditCashback', () => {
    it('credits cashbackBalance and writes a CASHBACK_EARNED ledger row', async () => {
      walletModel.findOneAndUpdate.mockReturnValue(
        resolvedWallet({ user: 'user1', cashbackBalance: 500 }),
      );

      await service.creditCashback(UID, 200, 'Cashback earned - DATA (VTU123)');

      expect(walletModel.findOneAndUpdate).toHaveBeenCalledWith(
        { user: expect.anything() },
        { $inc: { cashbackBalance: 200 } },
        expect.anything(),
      );
      const entry = ledgerModel.create.mock.calls[0][0][0];
      expect(entry.type).toBe('credit');
      expect(entry.wallet).toBe(PaymentWallet.CASHBACK);
      expect(entry.tag).toBe('CASHBACK_EARNED');
      expect(entry.amount).toBe(200);
      expect(entry.balanceBefore).toBe(300);
      expect(entry.balanceAfter).toBe(500);
    });

    it('rejects non-positive amounts', async () => {
      await expect(service.creditCashback(UID, 0, 'x')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.creditCashback(UID, -5, 'x')).rejects.toBeInstanceOf(BadRequestException);
      expect(walletModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFound when the wallet is missing', async () => {
      walletModel.findOneAndUpdate.mockReturnValue(resolvedWallet(null));
      await expect(service.creditCashback(UID, 100, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ledgerModel.create).not.toHaveBeenCalled();
    });
  });

  describe('debitCashback', () => {
    it('debits cashbackBalance and writes a CASHBACK_USED ledger row', async () => {
      walletModel.findOneAndUpdate.mockReturnValue(
        resolvedWallet({ user: 'user1', cashbackBalance: 400 }),
      );

      await service.debitCashback(UID, 100, 'Data bundle - MTN 1GB');

      expect(walletModel.findOneAndUpdate).toHaveBeenCalledWith(
        { user: expect.anything(), cashbackBalance: { $gte: 100 } },
        { $inc: { cashbackBalance: -100 } },
        expect.anything(),
      );
      const entry = ledgerModel.create.mock.calls[0][0][0];
      expect(entry.type).toBe('debit');
      expect(entry.wallet).toBe(PaymentWallet.CASHBACK);
      expect(entry.tag).toBe('CASHBACK_USED');
      expect(entry.amount).toBe(100);
      expect(entry.balanceBefore).toBe(500);
      expect(entry.balanceAfter).toBe(400);
    });

    it('throws BadRequest when cashback is insufficient and writes nothing', async () => {
      walletModel.findOneAndUpdate.mockReturnValue(resolvedWallet(null));

      await expect(service.debitCashback(UID, 999, 'x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(walletModel.findOneAndUpdate).toHaveBeenCalledWith(
        { user: expect.anything(), cashbackBalance: { $gte: 999 } },
        expect.anything(),
        expect.anything(),
      );
      expect(ledgerModel.create).not.toHaveBeenCalled();
    });

    it('rejects non-positive amounts', async () => {
      await expect(service.debitCashback(UID, 0, 'x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(ledgerModel.create).not.toHaveBeenCalled();
    });
  });
});