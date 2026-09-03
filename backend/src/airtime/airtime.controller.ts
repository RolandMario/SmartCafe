import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AirtimeService } from './airtime.service';
import { BuyAirtimeDto } from './dto/airtime.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('airtime')
@Controller('airtime')
export class AirtimeController {
  constructor(private readonly airtimeService: AirtimeService) {}

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buy airtime for a network' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: BuyAirtimeDto) {
    return this.airtimeService.purchase(user.userId, dto);
  }
}