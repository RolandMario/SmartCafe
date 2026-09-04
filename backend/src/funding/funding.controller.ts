import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FundingService } from './funding.service';
import { PaymentGatewayRegistry } from '../payments/payment-gateway.registry';
import { AdminApproveDto, DepositDto, QueryFundingDto } from './dto/funding.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Role } from '../common/enums';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('funding')
@Controller('funding')
export class FundingController {
  private readonly logger = new Logger(FundingController.name);

  constructor(
    private readonly fundingService: FundingService,
    private readonly gatewayRegistry: PaymentGatewayRegistry,
  ) {}

  @Get('gateways')
  @ApiOperation({
    summary:
      'Payment gateways currently active for wallet funding (configured + admin-enabled)',
  })
  gateways() {
    return {
      gateways: this.gatewayRegistry.all()
        .filter((g) => this.gatewayRegistry.isActive(g))
        .map((g) => ({ provider: g.name, label: g.label })),
    };
  }

  @Post('deposit')
  @ApiOperation({
    summary:
      'Create a wallet deposit / funding request. Returns a gateway checkoutUrl (Monnify or Paystack) when configured.',
  })
  deposit(@CurrentUser() user: AuthUser, @Body() dto: DepositDto, @Req() req: Request) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.fundingService.createDeposit(user.userId, dto.amount, baseUrl, dto.provider);
  }

  @Get('payment/:reference')
  @ApiOperation({
    summary:
      'Check a deposit against the payment gateway and credit the wallet if paid (idempotent)',
  })
  verify(@CurrentUser() user: AuthUser, @Param('reference') reference: string) {
    return this.fundingService.verifyPayment(user.userId, reference);
  }

  @Public()
  @Post('webhook/monnify')
  @ApiOperation({ summary: 'Monnify webhook (signed) — auto-credits wallet on success' })
  async monnifyWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const rawBody: Buffer =
        (req as Request & { rawBody?: Buffer }).rawBody ??
        Buffer.from(JSON.stringify(req.body ?? {}));
      await this.fundingService.handleWebhook('monnify', {
        payload: (req.body ?? {}) as Record<string, any>,
        rawBody,
        signature: (req.headers['monnify-signature'] as string) || undefined,
        sourceIp: req.ip,
      });
      return res.status(200).json({ message: 'Webhook received' });
    } catch (e) {
      this.logger.warn(`Monnify webhook rejected: ${e instanceof Error ? e.message : String(e)}`);
      return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid webhook' });
    }
  }

  @Public()
  @Post('webhook/paystack')
  @ApiOperation({ summary: 'Paystack webhook (HMAC-signed) — auto-credits wallet on success' })
  async paystackWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const rawBody: Buffer =
        (req as Request & { rawBody?: Buffer }).rawBody ??
        Buffer.from(JSON.stringify(req.body ?? {}));
      await this.fundingService.handleWebhook('paystack', {
        payload: (req.body ?? {}) as Record<string, any>,
        rawBody,
        signature: (req.headers['x-paystack-signature'] as string) || undefined,
        sourceIp: req.ip,
      });
      return res.status(200).json({ message: 'Webhook received' });
    } catch (e) {
      this.logger.warn(`Paystack webhook rejected: ${e instanceof Error ? e.message : String(e)}`);
      return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid webhook' });
    }
  }

  @Public()
  @Get('webhook/monnify/callback')
  @ApiOperation({ summary: 'Landing page Monnify redirects the customer to after payment' })
  monnifyCallback(@Query() query: Record<string, any>) {
    const status = String(query.status ?? '').toUpperCase();
    const ok = status === 'PAID' || status === 'SUCCESSFUL' || !!query.transactionReference;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment received</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f7fa;color:#0f172a}main{text-align:center;padding:2rem}h1{font-size:1.5rem}p{color:#475569}</style>
</head>
<body>
<main>
<h1>${ok ? '✅ Payment received' : '⏳ Payment processed'}</h1>
<p>Your wallet top-up is being confirmed. You can close this page and return to the app.</p>
${query.paymentReference ? `<p style="font-size:0.85rem;color:#94a3b8">Reference: ${String(query.paymentReference)}</p>` : ''}
</main>
</body>
</html>`;
  }

  @Public()
  @Get('webhook/paystack/callback')
  @ApiOperation({ summary: 'Landing page Paystack redirects the customer to after payment' })
  paystackCallback(@Query() query: Record<string, any>) {
    const status = String(query.status ?? '').toUpperCase();
    const ok = status === 'SUCCESS' || status === 'SUCCESSFUL' || !!query.reference;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment received</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f7fa;color:#0f172a}main{text-align:center;padding:2rem}h1{font-size:1.5rem}p{color:#475569}</style>
</head>
<body>
<main>
<h1>${ok ? '✅ Payment received' : '⏳ Payment processed'}</h1>
<p>Your wallet top-up is being confirmed. You can close this page and return to the app.</p>
${query.reference ? `<p style="font-size:0.85rem;color:#94a3b8">Reference: ${String(query.reference)}</p>` : ''}
</main>
</body>
</html>`;
  }

  @Get()
  @ApiOperation({ summary: 'My funding requests' })
  mine(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
    return this.fundingService.mine(user.userId, query);
  }

  @Roles(Role.ADMIN)
  @Get('admin/list')
  @ApiOperation({ summary: 'List all funding requests' })
  adminList(@Query() query: QueryFundingDto) {
    return this.fundingService.adminList(query);
  }

  @Roles(Role.ADMIN)
  @Post('admin/:id/approve')
  @ApiOperation({ summary: 'Approve a funding request and credit the wallet' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AdminApproveDto,
  ) {
    return this.fundingService.approve(id, user.userId, dto.note);
  }

  @Roles(Role.ADMIN)
  @Post('admin/:id/reject')
  @ApiOperation({ summary: 'Reject a funding request' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AdminApproveDto,
  ) {
    return this.fundingService.reject(id, user.userId, dto.note);
  }
}