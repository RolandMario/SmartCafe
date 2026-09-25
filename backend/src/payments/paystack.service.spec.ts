import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PaystackService } from './paystack.service';
import { PaystackDedicatedAccountData } from './paystack.types';

describe('PaystackService — DVA', () => {
  let service: PaystackService;
  let createSpy: jest.SpyInstance;

  const mockRequest = jest.fn();
  const mockGet = jest.fn();
  const mockPost = jest.fn();

  const dvaData: PaystackDedicatedAccountData = {
    account_name: 'Test User',
    account_number: '0123456789',
    assigned: true,
    active: true,
    currency: 'NGN',
    bank: { name: 'Test Bank', id: 705 },
  };

  // PaystackService builds its own axios client in the constructor, so we swap
  // `axios.create` for a stub client that records the outgoing request config
  // instead of hitting the network.
  const makeService = async (opts: {
    secretKey: string;
    preferredBank?: string;
  }) => {
    createSpy = jest
      .spyOn(axios, 'create')
      .mockReturnValue({
        defaults: {},
        request: mockRequest,
        get: mockGet,
        post: mockPost,
      } as any);
    mockRequest.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaystackService,
        {
          provide: ConfigService,
          useValue: {
            // Mirrors ConfigService.get: returns the supplied default when the
            // configured value is absent.
            get: jest.fn((path: string, def?: string) => {
              if (path === 'PAYSTACK_BASE_URL') return 'https://api.paystack.co';
              if (path === 'PAYSTACK_SECRET_KEY') return opts.secretKey;
              if (path === 'PAYSTACK_DVA_PREFERRED_BANK') {
                return opts.preferredBank === undefined ? def : opts.preferredBank;
              }
              return def;
            }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(PaystackService);
  };

  afterEach(() => createSpy?.mockRestore());

  // The stub records `client.request(config)`; pull that config back out.
  const sent = () => mockRequest.mock.calls[0]?.[0] as any;

  const respondSuccess = () =>
    mockRequest.mockResolvedValue({
      data: {
        status: true,
        message: 'Dedicated Virtual Account created',
        data: dvaData,
      },
    });

  it('defaults to test-bank under a test key', async () => {
    await makeService({ secretKey: 'sk_test_1234567890' });
    respondSuccess();
    const out = await service.createDedicatedAccount({ customerCode: 'CUS_abc' });
    expect(sent().data.preferred_bank).toBe('test-bank');
    expect(out).toEqual(dvaData);
  });

  it('corrects a live-only configured bank under a test key', async () => {
    await makeService({ secretKey: 'sk_test_1234567890', preferredBank: 'wema-bank' });
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    respondSuccess();
    await service.createDedicatedAccount({ customerCode: 'CUS_abc' });
    expect(sent().data.preferred_bank).toBe('test-bank');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('corrects a providus-bank configured under a test key too', async () => {
    await makeService({ secretKey: 'sk_test_1234567890', preferredBank: 'providus-bank' });
    respondSuccess();
    await service.createDedicatedAccount({ customerCode: 'CUS_abc' });
    expect(sent().data.preferred_bank).toBe('test-bank');
  });

  it('keeps wema-bank by default under a live key', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    respondSuccess();
    await service.createDedicatedAccount({ customerCode: 'CUS_abc' });
    expect(sent().data.preferred_bank).toBe('wema-bank');
  });

  it('passes explicit live banks through under a live key', async () => {
    await makeService({ secretKey: 'sk_live_1234567890', preferredBank: 'providus-bank' });
    respondSuccess();
    await service.createDedicatedAccount({ customerCode: 'CUS_abc' });
    expect(sent().data.preferred_bank).toBe('providus-bank');
  });

  it('corrects test-bank under a live key', async () => {
    await makeService({ secretKey: 'sk_live_1234567890', preferredBank: 'test-bank' });
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    respondSuccess();
    await service.createDedicatedAccount({ customerCode: 'CUS_abc' });
    expect(sent().data.preferred_bank).toBe('wema-bank');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sends the secret key as a bearer token on DVA requests', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    respondSuccess();
    await service.createDedicatedAccount({ customerCode: 'CUS_abc' });
    expect(sent().headers.Authorization).toBe('Bearer sk_live_1234567890');
    expect(sent().url).toBe('/dedicated_account');
  });

  it('surfaces the Paystack message when creation fails', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    mockRequest.mockResolvedValue({
      data: { status: false, message: 'bank not available', data: null },
    });
    await expect(
      service.createDedicatedAccount({ customerCode: 'CUS_abc' }),
    ).rejects.toThrow(
      'Paystack dedicated account creation failed: bank not available',
    );
  });

  // ---------------------------------------------------------------- getOrCreateCustomer

  it('creates the customer with phone when none exists on Paystack', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    mockRequest
      .mockRejectedValueOnce(new Error('Request failed with status code 404'))
      .mockResolvedValue({
        data: {
          status: true,
          message: 'Customer created',
          data: { id: 1, customer_code: 'CUS_new' },
        },
      });

    const out = await service.getOrCreateCustomer({
      email: 'ada@x.io',
      name: 'Ada Lovelace',
      phone: '08012345678',
    });

    expect(out).toEqual({ customerCode: 'CUS_new' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const [lookup, create] = mockRequest.mock.calls;
    expect(lookup[0].method).toBe('get');
    expect(lookup[0].url).toBe('/customer/ada%40x.io');
    expect(create[0].method).toBe('post');
    expect(create[0].url).toBe('/customer');
    expect(create[0].data).toEqual({
      email: 'ada@x.io',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '08012345678',
    });
  });

  it('reuses an existing customer that already has a phone', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    mockRequest.mockResolvedValue({
      data: {
        status: true,
        message: 'Customer retrieved',
        data: { id: 1, customer_code: 'CUS_existing', phone: '08012345678' },
      },
    });

    const out = await service.getOrCreateCustomer({
      email: 'ada@x.io',
      name: 'Ada Lovelace',
      phone: '08012345678',
    });

    expect(out).toEqual({ customerCode: 'CUS_existing' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0].method).toBe('get');
  });

  it('backfills the phone when the existing Paystack customer has none', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    // Phone-less customer — e.g. auto-created by a card checkout.
    mockRequest.mockResolvedValue({
      data: {
        status: true,
        message: 'Customer retrieved',
        data: { id: 1, customer_code: 'CUS_phoneless' },
      },
    });

    const out = await service.getOrCreateCustomer({
      email: 'ada@x.io',
      name: 'Ada Lovelace',
      phone: '08012345678',
    });

    expect(out).toEqual({ customerCode: 'CUS_phoneless' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const [lookup, update] = mockRequest.mock.calls;
    expect(lookup[0].method).toBe('get');
    expect(update[0].method).toBe('put');
    expect(update[0].url).toBe('/customer/CUS_phoneless');
    expect(update[0].data).toEqual({
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '08012345678',
    });
  });

  it('rejects a caller with no phone before touching Paystack', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    await expect(
      service.getOrCreateCustomer({ email: 'ada@x.io', name: 'Ada Lovelace' }),
    ).rejects.toThrow('A phone number is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-Nigerian phone before touching Paystack', async () => {
    await makeService({ secretKey: 'sk_live_1234567890' });
    await expect(
      service.getOrCreateCustomer({
        email: 'ada@x.io',
        name: 'Ada Lovelace',
        phone: '5551234',
      }),
    ).rejects.toThrow('not a valid Nigerian number');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
