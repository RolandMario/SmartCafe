import { Test } from '@nestjs/testing';
import { CableService } from './cable.service';
import { CableProvider } from './dto/cable.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { VendorService } from '../vendors/vendor.service';
import { UsersService } from '../users/users.service';

describe('CableService.verify → current plan + Renew', () => {
  let service: CableService;
  let verifyCustomer: jest.Mock;
  let getByService: jest.Mock;

  const CATALOG = [
    { _id: 'a1', provider: 'GOTV', productCode: 'gotv-smallie', name: 'GOtv Smallie', amount: 1900, commission: 28 },
    { _id: 'a2', provider: 'GOTV', productCode: 'gotv-jinja', name: 'GOtv Jinja', amount: 3900, commission: 58 },
    { _id: 'a3', provider: 'GOTV', productCode: 'gotv-jolli', name: 'GOtv Jolli', amount: 5800, commission: 87 },
    { _id: 'a4', provider: 'GOTV', productCode: 'gotv-max', name: 'GOtv Max', amount: 8500, commission: 127 },
    { _id: 'b1', provider: 'DSTV', productCode: 'dstv-padi', name: 'DStv Padi', amount: 1850, commission: 27 },
  ];

  beforeEach(async () => {
    verifyCustomer = jest.fn();
    getByService = jest.fn().mockResolvedValue(CATALOG);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CableService,
        { provide: TransactionsService, useValue: {} },
        { provide: CatalogService, useValue: { getByService } },
        { provide: VendorService, useValue: { verifyCustomer } },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(CableService);
  });

  it('recovers a current plan + renewal from Renewal_Amount when GOTV omits the bouquet name/code (live shape)', async () => {
    // Live GOTV payload for card 8064026388: Current_Bouquet: "" / Status: null
    // — VTPass's migrated billing no longer reports the bouquet, only the amount.
    verifyCustomer.mockResolvedValue({
      name: 'MUSTAPHA KOGBE',
      extra: {
        Customer_Name: 'MUSTAPHA KOGBE',
        Status: null,
        Due_Date: '2026-10-26T00:00:00',
        Customer_Type: 'GOTV',
        Current_Bouquet: '',
        Current_Bouquet_Price: '',
        Renewal_Amount: '3900',
        currentPlan: null,
      },
    });

    const result = await service.verify({
      provider: CableProvider.GOTV,
      smartCardNumber: '8064026388',
    });

    expect(result.name).toBe('MUSTAPHA KOGBE');
    expect(result.currentPlan).toEqual({
      productCode: 'gotv-jinja',
      name: 'GOtv Jinja',
      amount: 3900,
      dueDate: '2026-10-26T00:00:00',
    });
    expect(result.renewal).toEqual({
      packageId: 'a2',
      productCode: 'gotv-jinja',
      name: 'GOtv Jinja',
      amount: 3900,
      commission: 58,
    });
  });

  it('does NOT guess a plan when the renewal amount is shared by multiple plans', async () => {
    verifyCustomer.mockResolvedValue({
      name: 'SOMEONE',
      extra: {
        Current_Bouquet: '',
        Current_Bouquet_Code: 'UNKNOWN',
        Renewal_Amount: '5800',
        currentPlan: null,
      },
    });
    // Two GOTV plans cost 5,800 → the amount match must refuse to pick one.
    getByService.mockResolvedValue([
      ...CATALOG,
      { _id: 'x1', provider: 'GOTV', productCode: 'gotv-jinja-extra', name: 'GOtv Jinja Extra', amount: 5800, commission: 1 },
    ]);

    const result = await service.verify({
      provider: CableProvider.GOTV,
      smartCardNumber: '8064026388',
    });

    expect(result.currentPlan).toBeNull();
    expect(result.renewal).toBeNull();
  });

  it('keeps the normal code/name match path when VTPass reports the bouquet', async () => {
    verifyCustomer.mockResolvedValue({
      name: 'ADEBAYO OJO',
      extra: {
        Current_Bouquet: 'GOtv Jinja N3,300',
        Current_Bouquet_Code: 'gotv-jinja',
        Current_Bouquet_Price: '3300',
        Due_Date: '2026-10-14 00:00:00',
        Renewal_Amount: '3300',
        currentPlan: {
          productCode: 'gotv-jinja',
          name: 'GOtv Jinja',
          dueDate: '2026-10-14 00:00:00',
          amount: 3300,
        },
      },
    });

    const result = await service.verify({
      provider: CableProvider.GOTV,
      smartCardNumber: '8064026388',
    });

    expect(result.currentPlan).toMatchObject({
      productCode: 'gotv-jinja',
      name: 'GOtv Jinja',
    });
    // Catalog price wins over the vendor's renewal amount.
    expect(result.renewal).toMatchObject({
      packageId: 'a2',
      productCode: 'gotv-jinja',
      amount: 3900,
    });
  });
});
