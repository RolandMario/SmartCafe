import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceType } from '../common/enums';
import { BuyDataDto } from './dto/data.dto';

@Injectable()
export class DataService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
  ) {}

  async purchase(userId: string, dto: BuyDataDto) {
    const item = await this.catalogService.findById(dto.planId);
    if (item.service !== ServiceType.DATA || item.amount == null) {
      throw new BadRequestException('Selected plan is not a valid data bundle');
    }
    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.DATA,
      amount: item.amount,
      description: `Data bundle - ${item.providerLabel} ${item.name}`,
      meta: {
        provider: item.provider,
        providerLabel: item.providerLabel,
        plan: item.name,
        productCode: item.productCode,
        phone: dto.phone,
        amount: item.amount,
      },
      order: { productCode: item.productCode, phone: dto.phone },
      pin: dto.pin,
    });
  }
}