import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, Matches } from 'class-validator';
import { NIGERIAN_PHONE } from '../../airtime/dto/airtime.dto';
import { TRANSACTION_PIN_REGEX } from '../../users/dto/pin.dto';

export class BuyDataDto {
  @ApiProperty({ description: 'Catalog data-plan id' })
  @IsMongoId()
  planId: string;

  @ApiProperty({ example: '08012345678' })
  @Matches(NIGERIAN_PHONE, { message: 'Valid Nigerian phone number required' })
  phone: string;

  @ApiPropertyOptional({ example: '1234', description: '4-digit transaction PIN authorising this purchase' })
  @IsOptional()
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, { message: 'Transaction PIN must be exactly 4 digits' })
  pin?: string;
}

export class BuyDataDirectDto {
  @ApiProperty({ example: 'MTN' })
  @IsString()
  network: string;

  @ApiProperty({ example: 'mtn-1gb' })
  @IsString()
  productCode: string;
}