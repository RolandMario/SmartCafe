import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ServiceType } from '../../common/enums';
import { MockProvider } from './mock.provider';
import { VtpassProvider } from './vtpass.provider';
import { normalizeCablePlan } from './cable-verify.helper';

describe('Cable verify → currentPlan enrichment', () => {
  describe('MockProvider.verifyCustomer (CABLE)', () => {
    let provider: MockProvider;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          MockProvider,
          {
            provide: ConfigService,
            useValue: { get: jest.fn((_path: string, def?: string) => def) },
          },
        ],
      }).compile();
      provider = moduleRef.get(MockProvider);
    });

    it('returns a VTPass live-shaped flat payload plus a normalised currentPlan for every cable brand', async () => {
      for (const brand of ['DSTV', 'dstv', 'GOTV', 'STARTIMES']) {
        const result = await provider.verifyCustomer({
          serviceType: ServiceType.CABLE,
          provider: brand,
          identifier: '8123456789',
        });
        expect(result.name).toBeTruthy();
        // Mirrors VTPass's LIVE /merchant-verify payload shape (Current_Bouquet*).
        expect(result.extra?.Customer_Name).toBe(result.name);
        expect(result.extra?.Current_Bouquet).toBeTruthy();
        expect(result.extra?.Current_Bouquet_Code).toBeTruthy();
        expect(result.extra?.Current_Bouquet_Price).toBeTruthy();
        expect(result.extra?.Renewal_Amount).toBeTruthy();
        const plan = result.extra?.currentPlan;
        expect(plan).toBeDefined();
        expect(plan.name).toBeTruthy();
        expect(plan.productCode).toMatch(/^(dstv|gotv|nova|basic|smart|classic)/);
        expect(plan.amount).toBeGreaterThan(0);
        expect(plan.dueDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      }
    });
  });

  describe('normalizeCablePlan', () => {
    it('maps the LIVE flat DSTV/GOTV shape (Current_Bouquet / Current_Bouquet_Code / Current_Bouquet_Price / Due_Date / Renewal_Amount)', () => {
      const plan = normalizeCablePlan({
        Customer_Name: 'ADEBAYO OJO',
        Status: 'Active',
        Current_Bouquet: 'GOtv Jinja N3,300',
        Current_Bouquet_Code: 'gotv-jinja',
        Current_Bouquet_Price: '3300',
        Due_Date: '2026-10-14 00:00:00',
        Renewal_Amount: '3300',
        Customer_Type: 'GOTV',
        Customer_Number: '2019505346',
      });
      expect(plan).toEqual({
        productCode: 'gotv-jinja',
        name: 'GOtv Jinja',
        dueDate: '2026-10-14 00:00:00',
        amount: 3300,
      });
    });

    it('falls back to the name when Current_Bouquet_Code is UNKNOWN', () => {
      const plan = normalizeCablePlan({
        Customer_Name: 'CHINWE OKAFOR',
        Status: 'Closed',
        Current_Bouquet: 'DStv Confam',
        Current_Bouquet_Code: 'UNKNOWN',
        Current_Bouquet_Price: '',
        Due_Date: '2025-05-27T00:00:00',
        Renewal_Amount: '11000',
      });
      expect(plan).toEqual({
        productCode: undefined,
        name: 'DStv Confam',
        dueDate: '2025-05-27T00:00:00',
        amount: 11000,
      });
    });

    it('maps the flat DSTV verify fields (Product_Code / Product_Name / Due_Date / Renewal_Amount)', () => {
      const plan = normalizeCablePlan({
        Customer_Name: 'ADEBAYO OJO',
        Product_Code: 'dstv-confam',
        Product_Name: 'DStv Confam',
        Due_Date: '2026-10-14 00:00:00',
        Renewal_Amount: '11000',
      });
      expect(plan).toEqual({
        productCode: 'dstv-confam',
        name: 'DStv Confam',
        dueDate: '2026-10-14 00:00:00',
        amount: 11000,
      });
    });

    it('maps the StarTimes package shape (Package_Code / Package_Name) and strips the naira token', () => {
      const plan = normalizeCablePlan({
        Customer_Name: 'MUSA IBRAHIM',
        Package_Code: 'nova',
        Package_Name: 'StarTimes Nova - 2100 Naira - 1 Month',
        Due_Date: '2026-10-14',
        Renewal_Amount: '2100',
      });
      expect(plan).toEqual({
        productCode: 'nova',
        name: 'StarTimes Nova - 1 Month',
        dueDate: '2026-10-14',
        amount: 2100,
      });
    });

    it('maps nested GOTV product fields and strips the price token from the name', () => {
      const plan = normalizeCablePlan({
        'g-customer-name': 'OLUWASEUN ADEKYEMI',
        current_product: {
          productCode: 'gotv-max',
          productName: 'GOtv Max ₦8,500',
          dueDate: '2026-10-14 00:00:00',
          price: '8500',
        },
      });
      expect(plan).toEqual({
        productCode: 'gotv-max',
        name: 'GOtv Max',
        dueDate: '2026-10-14 00:00:00',
        amount: 8500,
      });
    });

    it('returns null when the card has no current plan data (or only an UNKNOWN code)', () => {
      expect(normalizeCablePlan({ 'g-customer-name': 'X' })).toBeNull();
      expect(
        normalizeCablePlan({
          Customer_Name: 'X',
          Current_Bouquet: '',
          Current_Bouquet_Code: 'UNKNOWN',
          Renewal_Amount: '',
        }),
      ).toBeNull();
    });
  });

  describe('VtpassProvider.verifyCustomer (CABLE)', () => {
    let provider: VtpassProvider;

    beforeAll(async () => {
      // VtpassProvider builds an axios client (with request interceptors) in its
      // constructor — swap axios.create for a stub; the tests below only drive
      // client.post, so no network is involved.
      jest
        .spyOn(axios, 'create')
        .mockReturnValue({
          defaults: {},
          interceptors: { request: { use: jest.fn() } },
          post: jest.fn(),
        } as any);
      const moduleRef = await Test.createTestingModule({
        providers: [
          VtpassProvider,
          {
            provide: ConfigService,
            useValue: { get: jest.fn((_path: string, def?: string) => def) },
          },
        ],
      }).compile();
      provider = moduleRef.get(VtpassProvider);
    });

    it('attaches a normalised currentPlan for a live DSTV verify payload', async () => {
      (provider as any).client.post.mockResolvedValue({
        data: {
          code: '000',
          response_description: '000',
          content: {
            Customer_Name: 'ADEBAYO OJO',
            Status: 'Active',
            Current_Bouquet: 'DStv Confam',
            Current_Bouquet_Code: 'dstv-confam',
            Current_Bouquet_Price: '11000',
            Due_Date: '2026-10-14 00:00:00',
            Renewal_Amount: '11000',
            Customer_Type: 'DSTV',
            Customer_Number: '8123456789',
          },
        },
      });
      const result = await provider.verifyCustomer({
        serviceType: ServiceType.CABLE,
        provider: 'dstv',
        identifier: '8123456789',
      });
      expect(result.name).toBe('ADEBAYO OJO');
      expect(result.extra?.currentPlan).toEqual({
        productCode: 'dstv-confam',
        name: 'DStv Confam',
        dueDate: '2026-10-14 00:00:00',
        amount: 11000,
      });
    });

    it('throws a clear BadRequest when VTPass rejects the smart card', async () => {
      (provider as any).client.post.mockResolvedValue({
        data: {
          code: '023',
          response_description: 'Invalid smartcard number',
          content: { error: 'Invalid smartcard number' },
        },
      });
      await expect(
        provider.verifyCustomer({
          serviceType: ServiceType.CABLE,
          provider: 'dstv',
          identifier: '0000000',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
