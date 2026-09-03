import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CatalogItem } from './schemas/catalog-item.schema';
import { CreateCatalogItemDto, QueryCatalogDto, UpdateCatalogItemDto } from './dto/catalog.dto';
import { ServiceType } from '../common/enums';

@Injectable()
export class CatalogService {
  constructor(
    @InjectModel(CatalogItem.name) private catalogModel: Model<CatalogItem>,
  ) {}

  /** Public listing — active items only, optionally filtered by service */
  async list(query: QueryCatalogDto) {
    const filter: Record<string, any> = { active: true };
    if (query.service) filter.service = query.service;
    return this.catalogModel.find(filter).sort({ service: 1, sortOrder: 1, createdAt: 1 });
  }

  /** Public list of services that are currently purchasable */
  async availableServices() {
    return this.catalogModel
      .distinct('service', { active: true })
      .then((services) => services as ServiceType[]);
  }

  async findById(id: string) {
    const item = await this.catalogModel.findById(id);
    if (!item) throw new NotFoundException('Catalog item not found');
    return item;
  }

  async getByService(service: ServiceType) {
    return this.catalogModel.find({ service, active: true }).sort({ sortOrder: 1 });
  }

  /** Resolve an active product by service + provider code (or product code) */
  async findByProvider(service: ServiceType, providerOrCode: string) {
    return this.catalogModel.findOne({
      service,
      active: true,
      $or: [{ provider: providerOrCode }, { productCode: providerOrCode }],
    });
  }

  // ---- Admin CRUD ----

  async create(dto: CreateCatalogItemDto) {
    return this.catalogModel.create({ ...dto });
  }

  async update(id: string, dto: UpdateCatalogItemDto) {
    const item = await this.catalogModel.findByIdAndUpdate(id, { $set: dto }, { new: true });
    if (!item) throw new NotFoundException('Catalog item not found');
    return item;
  }

  async remove(id: string) {
    const item = await this.catalogModel.findByIdAndDelete(id);
    if (!item) throw new NotFoundException('Catalog item not found');
    return { deleted: true, id };
  }

  async adminList(query: QueryCatalogDto) {
    const filter: Record<string, any> = {};
    if (query.service) filter.service = query.service;
    return this.catalogModel.find(filter).sort({ service: 1, sortOrder: 1, createdAt: 1 });
  }
}