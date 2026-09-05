import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { TransactionsService } from '../transactions/transactions.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { CatalogService } from '../catalog/catalog.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, ServiceType } from '../common/enums';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { QueryTransactionsDto } from '../transactions/dto/transactions.dto';
import { SearchPaginationDto } from '../common/dto/pagination.dto';
import { CreateCatalogItemDto, QueryCatalogDto, UpdateCatalogItemDto } from '../catalog/dto/catalog.dto';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorService } from '../vendors/vendor.service';
import { PaymentGatewayRegistry } from '../payments/payment-gateway.registry';
import { PaymentProvider } from '../payments/payment-gateway.interface';

class CreditWalletDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  role?: Role;
}

class UpdateVendorDto {
  @ApiProperty({ enum: ServiceType })
  @IsEnum(ServiceType)
  service: ServiceType;

  @ApiProperty({ enum: ['mock', 'vtpass', 'ebulksms'] })
  @IsIn(['mock', 'vtpass', 'ebulksms'])
  provider: string;
}

class UpdatePaymentGatewayDto {
  @ApiProperty({ description: 'Enable or disable the gateway for wallet funding' })
  @IsBoolean()
  enabled: boolean;
}

@ApiTags('admin')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly transactionsService: TransactionsService,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly catalogService: CatalogService,
    private readonly vendorService: VendorService,
    private readonly paymentGatewayRegistry: PaymentGatewayRegistry,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Platform overview statistics' })
  dashboard() {
    return this.adminService.dashboard();
  }

  @Get('profits')
  @ApiOperation({
    summary:
      'Profit report: realized profit per service + current live margins per product',
  })
  profits(@Query('range') range?: string) {
    return this.adminService.profits(range);
  }

  // ---------------- Vendors ----------------
  @Get('vendors')
  @ApiOperation({ summary: 'List vendor providers and per-service routing' })
  vendorOverview() {
    return this.vendorService.getVendorOverview();
  }

  @Get('vendors/balance')
  @ApiOperation({ summary: 'Balances for each configured vendor provider' })
  vendorBalances() {
    return this.vendorService.getBalances();
  }

  @Patch('vendors')
  @ApiOperation({ summary: 'Set the vendor provider for a service' })
  updateVendor(@Body() dto: UpdateVendorDto) {
    return this.vendorService.setProvider(dto.service, dto.provider);
  }

  // ---------------- Payment gateways (wallet funding) ----------------
  @Get('payment-gateways')
  @ApiOperation({
    summary:
      'List payment gateways with their config + admin-enabled state for wallet funding',
  })
  paymentGateways() {
    return this.paymentGatewayRegistry.overview();
  }

  @Patch('payment-gateways/:provider')
  @ApiOperation({
    summary:
      'Enable or disable a payment gateway for new wallet funding requests',
  })
  updatePaymentGateway(
    @CurrentUser() user: AuthUser,
    @Param('provider') providerParam: string,
    @Body() dto: UpdatePaymentGatewayDto,
  ) {
    const provider = String(providerParam).toLowerCase();
    if (provider !== 'monnify' && provider !== 'paystack') {
      throw new BadRequestException(
        `Unknown payment gateway: ${providerParam} (expected monnify or paystack)`,
      );
    }
    return this.paymentGatewayRegistry.setEnabled(
      provider as PaymentProvider,
      dto.enabled,
      user.userId,
    );
  }

  // ---------------- Transactions ----------------
  @Get('transactions')
  @ApiOperation({ summary: 'List all transactions' })
  transactions(@Query() query: QueryTransactionsDto) {
    return this.adminService.transactions(query);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Transaction detail' })
  transaction(@Param('id') id: string) {
    return this.adminService.transactionDetail(id);
  }

  @Post('transactions/:id/requery')
  @ApiOperation({ summary: 'Requery a transaction against the vendor' })
  requery(@Param('id') id: string) {
    return this.adminService.requeryTransaction(id);
  }

  // ---------------- Users ----------------
  @Get('users')
  @ApiOperation({ summary: 'List / search users' })
  users(@Query() query: SearchPaginationDto) {
    return this.usersService.adminList(query);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Activate / deactivate a user or change role' })
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.adminUpdate(id, dto);
  }

  @Post('users/:id/credit')
  @ApiOperation({ summary: 'Manually credit a user wallet' })
  creditWallet(@Param('id') id: string, @Body() dto: CreditWalletDto) {
    return this.walletService.credit(id, dto.amount, dto.note ?? 'Admin credit');
  }

  // ---------------- Catalog ----------------
  @Get('catalog')
  @ApiOperation({ summary: 'List catalog items (admin)' })
  catalog(@Query() query: QueryCatalogDto) {
    return this.catalogService.adminList(query);
  }

  @Post('catalog')
  @ApiOperation({ summary: 'Create a catalog item' })
  createCatalog(@Body() dto: CreateCatalogItemDto) {
    return this.catalogService.create(dto);
  }

  @Patch('catalog/:id')
  @ApiOperation({ summary: 'Update a catalog item' })
  updateCatalog(@Param('id') id: string, @Body() dto: UpdateCatalogItemDto) {
    return this.catalogService.update(id, dto);
  }

  @Delete('catalog/:id')
  @ApiOperation({ summary: 'Delete a catalog item' })
  deleteCatalog(@Param('id') id: string) {
    return this.catalogService.remove(id);
  }
}