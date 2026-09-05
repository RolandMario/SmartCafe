import { Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceType } from '../common/enums';
import { SendBulkSmsDto } from './dto/sms.dto';

/** ebulksms segments messages into 160-char pages; each page costs one unit. */
const SMS_PAGE_LENGTH = 160;

@Injectable()
export class SmsService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
  ) {}

  /** Return the current per-unit SMS price and how many units a campaign needs. */
  async quote(recipientsCount: number, messageLength = 0) {
    const items = await this.catalogService.getByService(ServiceType.SMS);
    const item = items[0];
    const unitPrice = item?.unitPrice ?? 2.5;
    const pages = Math.max(1, Math.ceil(messageLength / SMS_PAGE_LENGTH));
    const units = recipientsCount * pages;
    return { unitPrice, units, pages, messageLength, amount: Math.ceil(unitPrice * units) };
  }

  async purchase(userId: string, dto: SendBulkSmsDto) {
    const { unitPrice, units, pages, amount } = await this.quote(
      dto.recipients.length,
      dto.message.length,
    );
    const items = await this.catalogService.getByService(ServiceType.SMS);
    const item = items[0];
    // SMS vendors (VTPass messaging / ebulksms) report no per-message price in the
    // send response, so the provider cost is derived from the admin-set per-unit
    // vendor rate (falls back to the sales unit price → zero profit if unset).
    const providerUnitCost = item?.providerUnitCost ?? unitPrice;
    const providerCost = Math.round(providerUnitCost * units * 100) / 100;
    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.SMS,
      amount,
      description: `Bulk SMS - ${units} unit(s) · ${dto.recipients.length} recipient(s)`,
      providerCost,
      meta: {
        senderName: dto.senderName,
        units,
        pages,
        recipientsCount: dto.recipients.length,
        messageLength: dto.message.length,
        unitPrice,
        providerUnitCost,
        amount,
        message: dto.message.slice(0, 100),
      },
      order: { senderName: dto.senderName, message: dto.message, recipients: dto.recipients },
      pin: dto.pin,
    });
  }
}