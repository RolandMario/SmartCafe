import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { ServiceType } from '../common/enums';
import { BuyDataDto } from './dto/data.dto';

@Injectable()
export class DataService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
  ) {}

  async purchase(userId: string, dto: BuyDataDto) {
    let item: CatalogItem;
    try {
      item = await this.catalogService.findById(dto.planId);
    } catch {
      // The plan list may have been replaced by a provider switch (e.g.
      // vtpass -> pairgate re-seeds the DATA catalog, pruning old plan ids) —
      // surface a clear "refresh your list" message instead of a bare 404.
      throw new BadRequestException(
        'This data plan is no longer available — the bundle list was refreshed. Please go back and select a current plan.',
      );
    }
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
      order: { productCode: item.productCode, provider: item.provider, phone: dto.phone },
      pin: dto.pin,
    });
  }
}