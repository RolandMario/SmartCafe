import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { SmsService } from './sms.service';
import { SendBulkSmsDto } from './dto/sms.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

class SmsQuoteQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  recipients: number;

  /** Message length in chars — used to price multi-page (160 chars) campaigns. */
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  messageLength?: number;
}

@ApiTags('sms')
@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Public()
  @Get('quote')
  @ApiOperation({ summary: 'Quote cost for N recipients' })
  quote(@Query() query: SmsQuoteQuery) {
    return this.smsService.quote(query.recipients, query.messageLength);
  }

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a bulk SMS campaign' })
  purchase(@CurrentUser() user: AuthUser, @Body() dto: SendBulkSmsDto) {
    return this.smsService.purchase(user.userId, dto);
  }
}