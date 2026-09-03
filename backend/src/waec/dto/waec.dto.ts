import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  Max,
  MinLength,
  Matches,
} from 'class-validator';
import { TRANSACTION_PIN_REGEX } from '../../users/dto/pin.dto';

export class BuyWaecDto {
  @ApiProperty({ description: 'Catalog WAEC product id (result checker or registration)' })
  @IsMongoId()
  productId: string;

  @ApiPropertyOptional({ description: 'Candidate full name (registration only)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  candidateName?: string;

  @ApiPropertyOptional({ example: 'WASSCE', description: 'Exam type (registration only)' })
  @IsOptional()
  @IsString()
  examType?: string;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  examYear?: number;

  @ApiPropertyOptional({ description: 'State (registration only)' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '1234', description: '4-digit transaction PIN authorising this purchase' })
  @IsOptional()
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, { message: 'Transaction PIN must be exactly 4 digits' })
  pin?: string;

  @ApiPropertyOptional({ example: 2, description: 'Number of registration PINs to purchase (registration only). Defaults to 1.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  quantity?: number;
}