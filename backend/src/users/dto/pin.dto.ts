import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export const TRANSACTION_PIN_REGEX = /^\d{4}$/;

export class SetPinDto {
  @ApiProperty({ example: '1234', description: 'New 4-digit transaction PIN' })
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, {
    message: 'Transaction PIN must be exactly 4 digits',
  })
  pin: string;

  @ApiPropertyOptional({
    example: '1234',
    description: 'Current 4-digit transaction PIN (required when changing an existing PIN)',
  })
  @IsOptional()
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, {
    message: 'Transaction PIN must be exactly 4 digits',
  })
  currentPin?: string;
}

export class VerifyPinDto {
  @ApiProperty({ example: '1234' })
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, {
    message: 'Transaction PIN must be exactly 4 digits',
  })
  pin: string;
}