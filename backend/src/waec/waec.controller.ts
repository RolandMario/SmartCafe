import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WaecService } from './waec.service';
import { BuyWaecDto } from './dto/waec.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('waec')
@Controller('waec')
export class WaecController {
  constructor(private readonly waecService: WaecService) {}

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purchase WAEC result checker PIN or registration' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: BuyWaecDto) {
    return this.waecService.purchase(user.userId, dto);
  }
}