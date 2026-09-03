import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { UsersService } from '../users/users.service';
import { ServiceType } from '../common/enums';
import { BuyWaecDto } from './dto/waec.dto';

@Injectable()
export class WaecService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
    private usersService: UsersService,
  ) {}

  async purchase(userId: string, dto: BuyWaecDto) {
    const item = await this.catalogService.findById(dto.productId);
    if (item.service !== ServiceType.WAEC || item.amount == null) {
      throw new BadRequestException('Selected product is not a valid WAEC product');
    }
    // Multiple registration PINs can be bought in one request (quantity defaults to 1).
    const quantity = dto.quantity ?? 1;
    const amount = item.amount * quantity;

    // VTPass requires a recipient `phone` for WAEC purchases — use the account phone.
    const user = await this.usersService.findById(userId);
    const isRegistration = item.productCode === 'waec-registration';
    const customerData = isRegistration
      ? {
          candidateName: dto.candidateName ?? '',
          examType: dto.examType ?? 'WASSCE',
          examYear: dto.examYear ?? new Date().getFullYear(),
          state: dto.state ?? '',
        }
      : undefined;

    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.WAEC,
      amount,
      description: `WAEC - ${item.name}${quantity > 1 ? ` (x${quantity})` : ''}`,
      meta: {
        product: item.name,
        productCode: item.productCode,
        quantity,
        ...(customerData ?? {}),
      },
      order: { productCode: item.productCode, phone: user?.phone ?? '', quantity, customerData },
      pin: dto.pin,
    });
  }
}