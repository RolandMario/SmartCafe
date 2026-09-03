import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceType } from '../common/enums';
import { BuyAirtimeDto } from './dto/airtime.dto';

@Injectable()
export class AirtimeService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
  ) {}

  async purchase(userId: string, dto: BuyAirtimeDto) {
    const item = await this.catalogService.findByProvider(ServiceType.AIRTIME, dto.network);
    const productCode = item?.productCode ?? dto.network.toLowerCase();

    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.AIRTIME,
      amount: dto.amount,
      description: `Airtime top-up - ${dto.network}`,
      meta: { network: dto.network, phone: dto.phone, amount: dto.amount },
      order: { productCode, phone: dto.phone },
      pin: dto.pin,
    });
  }
}