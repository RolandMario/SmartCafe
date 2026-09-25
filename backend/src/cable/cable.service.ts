import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { VendorService } from '../vendors/vendor.service';
import { UsersService } from '../users/users.service';
import { ServiceType } from '../common/enums';
import { BuyCableDto, VerifyCableDto } from './dto/cable.dto';

@Injectable()
export class CableService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
    private vendorService: VendorService,
    private usersService: UsersService,
  ) {}

  async verify(dto: VerifyCableDto) {
    // VTPass verifies cable smart cards against a per-brand serviceID
    // (dstv | gotv | startimes), NOT a package variation code — the first
    // catalog row's productCode the old lookup returned ("dstv-padi", ...) is
    // rejected with "product does not exist". The provider enum maps 1:1.
    return this.vendorService.verifyCustomer({
      serviceType: ServiceType.CABLE,
      provider: dto.provider.toLowerCase(),
      identifier: dto.smartCardNumber,
    });
  }

  async purchase(userId: string, dto: BuyCableDto) {
    const pkg = await this.catalogService.findById(dto.packageId);
    if (pkg.service !== ServiceType.CABLE || pkg.amount == null) {
      throw new BadRequestException('Selected package is not a valid cable plan');
    }
    // VTPass requires a contact `phone` for cable purchases — use the account phone.
    const user = await this.usersService.findById(userId);
    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.CABLE,
      amount: pkg.amount,
      description: `Cable subscription - ${pkg.providerLabel} ${pkg.name}`,
      meta: {
        provider: pkg.provider,
        providerLabel: pkg.providerLabel,
        plan: pkg.name,
        productCode: pkg.productCode,
        smartCardNumber: dto.smartCardNumber,
        phone: user?.phone ?? '',
        amount: pkg.amount,
      },
      order: {
        productCode: pkg.productCode,
        // Threads the catalog provider slug through to VTPass's buyCable so it
        // can pick the right serviceID (dstv | gotv | startimes) — the variation
        // code alone can't tell GOTV/StarTimes packages apart.
        provider: pkg.provider,
        smartCardNumber: dto.smartCardNumber,
        phone: user?.phone ?? '',
      },
      paymentWallet: dto.wallet,
      cashback: pkg.commission ?? 0,
      pin: dto.pin,
    });
  }
}