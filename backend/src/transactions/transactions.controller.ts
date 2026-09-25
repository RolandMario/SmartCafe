import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { QueryStatsDto, QueryTransactionsDto } from './dto/transactions.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'My transaction history' })
  mine(@CurrentUser() user: AuthUser, @Query() query: QueryTransactionsDto) {
    return this.transactionsService.myTransactions(user.userId, query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'My purchase analytics — number of successful purchases (and volume) per service',
  })
  stats(@CurrentUser() user: AuthUser, @Query() query: QueryStatsDto) {
    return this.transactionsService.stats(user.userId, query.month);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my transactions' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transactionsService.findForUser(user.userId, id);
  }

  @Post(':id/requery')
  @ApiOperation({ summary: 'Manually requery a pending transaction' })
  requery(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transactionsService.requery(id, user.userId);
  }
}