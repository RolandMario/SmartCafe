import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { TRANSACTION_PIN_REGEX } from '../../users/dto/pin.dto';

export const NIGERIAN_PHONE = /^(\+?234|0)[789][01]\d{8}$/;

export enum AirtimeNetwork {
  MTN = 'MTN',
  GLO = 'GLO',
  AIRTEL = 'AIRTEL',
  '9MOBILE' = '9MOBILE',
}

export class BuyAirtimeDto {
  @ApiProperty({ enum: AirtimeNetwork })
  @IsEnum(AirtimeNetwork)
  network: AirtimeNetwork;

  @ApiProperty({ example: '08012345678' })
  @Matches(NIGERIAN_PHONE, { message: 'Valid Nigerian phone number required' })
  phone: string;

  @ApiProperty({ example: 500, minimum: 50, maximum: 100000 })
  @Type(() => Number)
  @IsNumber()
  @Min(50)
  @Max(100000)
  amount: number;

  @ApiPropertyOptional({ example: '1234', description: '4-digit transaction PIN authorising this purchase' })
  @IsOptional()
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, { message: 'Transaction PIN must be exactly 4 digits' })
  pin?: string;
}