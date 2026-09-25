import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NIGERIAN_PHONE } from '../../airtime/dto/airtime.dto';
import { TRANSACTION_PIN_REGEX } from '../../users/dto/pin.dto';
import { PaymentWallet } from '../../common/enums';

export class SendBulkSmsDto {
  @ApiProperty({ example: 'MyBrand', description: 'Alpha sender ID (3-11 alphanumeric)' })
  @IsString()
  @Matches(/^[a-zA-Z0-9]{3,11}$/, {
    message: 'senderName must be 3-11 alphanumeric characters',
  })
  senderName: string;

  @ApiProperty({ example: 'Hello! Your order is confirmed.' })
  @IsString()
  @MinLength(1)
  // ebulksms hard limit: 4 pages of 160 chars = 612 chars (docs /pages/json-api)
  @MaxLength(612)
  message: string;

  @ApiProperty({
    example: ['08012345678', '08098765432'],
    description: 'Recipient phone numbers',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @Matches(NIGERIAN_PHONE, { each: true, message: 'All recipients must be valid Nigerian numbers' })
  recipients: string[];

  @ApiPropertyOptional({
    enum: PaymentWallet,
    default: PaymentWallet.MAIN,
    description: "Wallet to fund the purchase from ('main' default | 'cashback').",
  })
  @IsOptional()
  @IsEnum(PaymentWallet)
  wallet?: PaymentWallet;

  @ApiPropertyOptional({ example: '1234', description: '4-digit transaction PIN authorising this purchase' })
  @IsOptional()
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, { message: 'Transaction PIN must be exactly 4 digits' })
  pin?: string;
}