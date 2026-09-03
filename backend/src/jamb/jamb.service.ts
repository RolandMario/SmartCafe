import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { VendorService } from '../vendors/vendor.service';
import { UsersService } from '../users/users.service';
import { ServiceType } from '../common/enums';
import { BuyJambDto, VerifyJambDto } from './dto/jamb.dto';

@Injectable()
export class JambService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
    private vendorService: VendorService,
    private usersService: UsersService,
  ) {}

  /** Verify a JAMB profile ID and return the candidate name (VTPass /merchant-verify). */
  async verify(dto: VerifyJambDto) {
    const item = await this.catalogService.findById(dto.productId);
    if (item.service !== ServiceType.JAMB) {
      throw new BadRequestException('Selected product is not a valid JAMB product');
    }
    return this.vendorService.verifyCustomer({
      serviceType: ServiceType.JAMB,
      provider: item.productCode,
      identifier: dto.profileId,
      subType: item.productCode,
    });
  }

  async purchase(userId: string, dto: BuyJambDto) {
    const item = await this.catalogService.findById(dto.productId);
    if (item.service !== ServiceType.JAMB || item.amount == null) {
      throw new BadRequestException('Selected product is not a valid JAMB product');
    }
    // VTPass requires a recipient `phone` for JAMB purchases — use the account phone.
    const user = await this.usersService.findById(userId);
    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.JAMB,
      amount: item.amount,
      description: `JAMB PIN - ${item.name}`,
      meta: {
        provider: item.provider,
        providerLabel: item.providerLabel,
        product: item.name,
        productCode: item.productCode,
        profileId: dto.profileId,
        amount: item.amount,
      },
      order: {
        productCode: item.productCode,
        phone: user?.phone ?? '',
        customerData: { profileId: dto.profileId },
      },
      pin: dto.pin,
    });
  }
}