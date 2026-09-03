import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
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
    enum: ['monnify', 'paystack'],
    description:
      'Payment gateway to use. Defaults to the first configured gateway (Monnify, then Paystack). Falls back to the manual admin flow when the choice is unavailable or nothing is configured.',
  })
  @IsOptional()
  @IsIn(['monnify', 'paystack'])
  provider?: PaymentProvider;
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