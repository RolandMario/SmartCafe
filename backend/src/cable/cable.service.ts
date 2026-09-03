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
    const item = await this.catalogService.findByProvider(ServiceType.CABLE, dto.provider);
    const providerCode = item?.productCode ?? dto.provider.toLowerCase();
    return this.vendorService.verifyCustomer({
      serviceType: ServiceType.CABLE,
      provider: providerCode,
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
        smartCardNumber: dto.smartCardNumber,
        phone: user?.phone ?? '',
      },
      pin: dto.pin,
    });
  }
}