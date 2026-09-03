import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get wallet balance' })
  balance(@CurrentUser() user: AuthUser) {
    return this.walletService.getBalance(user.userId);
  }

  @Get('ledger')
  @ApiOperation({ summary: 'Wallet transaction history (credits & debits)' })
  ledger(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
    return this.walletService.ledger(user.userId, query);
  }
}