import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataService } from './data.service';
import { BuyDataDto } from './dto/data.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('data')
@Controller('data')
export class DataController {
  constructor(private readonly dataService: DataService) {}

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Subscribe to a data bundle' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: BuyDataDto) {
    return this.dataService.purchase(user.userId, dto);
  }
}