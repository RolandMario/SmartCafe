import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { QueryCatalogDto } from './dto/catalog.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List purchasable products (filter by service)' })
  list(@Query() query: QueryCatalogDto) {
    return this.catalogService.list(query);
  }

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'List the service types currently available' })
  services() {
    return this.catalogService.availableServices();
  }
}