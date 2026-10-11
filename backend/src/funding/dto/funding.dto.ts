import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FundingStatus } from '../../common/enums';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaymentProvider } from '../../payments/payment-gateway.interface';

export class DepositDto {
  @ApiProperty({ example: 5000, minimum: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  amount: number;

  @ApiPropertyOptional({
    enum: ['paystack', 'cashback'],
    description:
      'Payment method to use: "paystack" opens a hosted checkout (default), "cashback" creates a manual bank-transfer request to our company account that an admin verifies before crediting. Falls back to the manual admin flow when a gateway is unavailable.',
  })
  @IsOptional()
  @IsIn(['paystack', 'cashback'])
  provider?: PaymentProvider;

  @ApiPropertyOptional({
    example: '220190173001',
    description:
      'Reference number shown on the user\'s bank transfer to the company account. Required for provider "cashback" — the admin uses it to match and verify the transfer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transferReference?: string;
}

export class AdminApproveDto {
  @ApiPropertyOptional({ description: 'Admin note to the user' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryFundingDto extends PaginationDto {
  @ApiPropertyOptional({ enum: FundingStatus })
  @IsOptional()
  @IsEnum(FundingStatus)
  status?: FundingStatus;
}

export class SetCashbackFundingConfigDto {
  @ApiProperty({
    example: 2,
    minimum: 0,
    maximum: 100,
    description:
      'Cashback funding bonus percentage (0–100) of the funded amount credited to the user cashback wallet when a Cashback Funding request is approved. 0 disables the bonus.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage: number;
}