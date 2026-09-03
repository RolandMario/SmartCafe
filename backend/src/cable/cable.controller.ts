import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CableService } from './cable.service';
import { BuyCableDto, VerifyCableDto } from './dto/cable.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('cable')
@Controller('cable')
export class CableController {
  constructor(private readonly cableService: CableService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a smart-card number and get the customer name' })
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyCableDto) {
    return this.cableService.verify(dto);
  }

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Subscribe to a cable TV package' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: BuyCableDto) {
    return this.cableService.purchase(user.userId, dto);
  }
}