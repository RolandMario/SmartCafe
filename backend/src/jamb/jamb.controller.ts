import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JambService } from './jamb.service';
import { BuyJambDto, VerifyJambDto } from './dto/jamb.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('jamb')
@Controller('jamb')
export class JambController {
  constructor(private readonly jambService: JambService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a JAMB profile ID and get the candidate name' })
  verify(@Body() dto: VerifyJambDto) {
    return this.jambService.verify(dto);
  }

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purchase a JAMB UTME / Direct Entry PIN' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: BuyJambDto) {
    return this.jambService.purchase(user.userId, dto);
  }
}