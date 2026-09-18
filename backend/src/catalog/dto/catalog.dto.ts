import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceType } from '../../common/enums';

export class QueryCatalogDto {
  @ApiPropertyOptional({ enum: ServiceType })
  @IsOptional()
  @IsEnum(ServiceType)
  service?: ServiceType;

  @ApiPropertyOptional({
    enum: ['pairgate', 'vtpass', 'static'],
    description: 'Filter by fulfilling vendor (pairgate | vtpass | static).',
  })
  @IsOptional()
  @IsIn(['pairgate', 'vtpass', 'static'])
  vendor?: 'pairgate' | 'vtpass' | 'static';

  @ApiPropertyOptional({ description: 'One-based page number (admin list).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Rows per page (admin list, default 15).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  perPage?: number;
}

export class CreateCatalogItemDto {
  @ApiProperty({ enum: ServiceType })
  @IsEnum(ServiceType)
  service: ServiceType;

  @ApiProperty({ example: 'MTN' })
  @IsString()
  provider: string;

  @ApiProperty({ example: 'MTN Nigeria' })
  @IsString()
  providerLabel: string;

  @ApiProperty({ example: 'mtn' })
  @IsString()
  productCode: string;

  @ApiProperty({ example: 'MTN Airtime' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Fixed selling price' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  @ApiPropertyOptional({ description: 'Price per unit for SMS' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Provider cost per SMS unit (for profit reports)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  providerUnitCost?: number;

  @ApiPropertyOptional({ description: 'Validity period in days (data bundles)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  validityDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commission?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {}