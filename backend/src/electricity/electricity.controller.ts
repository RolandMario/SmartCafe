import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ElectricityService } from './electricity.service';
import { BuyElectricityDto, VerifyElectricityDto } from './dto/electricity.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('electricity')
@Controller('electricity')
export class ElectricityController {
  constructor(private readonly electricityService: ElectricityService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a meter number and return the customer name/address' })
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyElectricityDto) {
    return this.electricityService.verify(dto);
  }

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pay electricity bill and receive a token' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: BuyElectricityDto) {
    return this.electricityService.purchase(user.userId, dto);
  }
}