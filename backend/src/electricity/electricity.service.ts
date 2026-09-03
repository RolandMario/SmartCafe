import { Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { VendorService } from '../vendors/vendor.service';
import { UsersService } from '../users/users.service';
import { ServiceType } from '../common/enums';
import { BuyElectricityDto, VerifyElectricityDto } from './dto/electricity.dto';

@Injectable()
export class ElectricityService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
    private vendorService: VendorService,
    private usersService: UsersService,
  ) {}

  async verify(dto: VerifyElectricityDto) {
    const disco = await this.catalogService.findByProvider(ServiceType.ELECTRICITY, dto.disco);
    return this.vendorService.verifyCustomer({
      serviceType: ServiceType.ELECTRICITY,
      provider: disco?.productCode ?? dto.disco,
      identifier: dto.meterNumber,
      subType: dto.meterType,
    });
  }

  async purchase(userId: string, dto: BuyElectricityDto) {
    const disco = await this.catalogService.findByProvider(ServiceType.ELECTRICITY, dto.disco);
    const productCode = disco?.productCode ?? dto.disco;
    const discoLabel = disco?.providerLabel ?? dto.disco;
    // VTPass requires a contact `phone` — use the account phone.
    const user = await this.usersService.findById(userId);

    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.ELECTRICITY,
      amount: dto.amount,
      description: `Electricity bill payment - ${discoLabel}`,
      meta: {
        disco: dto.disco,
        discoLabel,
        meterNumber: dto.meterNumber,
        meterType: dto.meterType,
        amount: dto.amount,
      },
      order: {
        productCode,
        meterNumber: dto.meterNumber,
        phone: user?.phone ?? '',
        customerData: { meterType: dto.meterType },
      },
      pin: dto.pin,
    });
  }
}