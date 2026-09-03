import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Matches } from 'class-validator';
import { TRANSACTION_PIN_REGEX } from '../../users/dto/pin.dto';

export enum MeterType {
  PREPAID = 'prepaid',
  POSTPAID = 'postpaid',
}

export class VerifyElectricityDto {
  @ApiProperty({ example: 'ikeja-electric', description: 'Disco provider code' })
  @IsString()
  @IsNotEmpty()
  disco: string;

  @ApiProperty({ example: '04210123456' })
  @IsString()
  @MinLength(6)
  meterNumber: string;

  @ApiProperty({ enum: MeterType })
  @IsEnum(MeterType)
  meterType: MeterType;
}

export class BuyElectricityDto extends VerifyElectricityDto {
  @ApiProperty({ example: 5000, minimum: 500, maximum: 1000000 })
  @Type(() => Number)
  @IsNumber()
  @Min(500)
  @Max(1000000)
  amount: number;

  @ApiPropertyOptional({ example: '1234', description: '4-digit transaction PIN authorising this purchase' })
  @IsOptional()
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, { message: 'Transaction PIN must be exactly 4 digits' })
  pin?: string;
}