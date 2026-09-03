import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { TRANSACTION_PIN_REGEX } from '../../users/dto/pin.dto';

export enum CableProvider {
  DSTV = 'DSTV',
  GOTV = 'GOTV',
  STARTIMES = 'STARTIMES',
}

export class VerifyCableDto {
  @ApiProperty({ enum: CableProvider })
  @IsEnum(CableProvider)
  provider: CableProvider;

  @ApiProperty({ example: '8123456789' })
  @IsString()
  @MinLength(7)
  smartCardNumber: string;
}

export class BuyCableDto extends VerifyCableDto {
  @ApiProperty({ description: 'Catalog package id' })
  @IsMongoId()
  packageId: string;

  @ApiPropertyOptional({ example: '1234', description: '4-digit transaction PIN authorising this purchase' })
  @IsOptional()
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, { message: 'Transaction PIN must be exactly 4 digits' })
  pin?: string;
}