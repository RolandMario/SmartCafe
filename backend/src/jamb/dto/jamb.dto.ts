import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsString, Matches, MinLength } from 'class-validator';
import { TRANSACTION_PIN_REGEX } from '../../users/dto/pin.dto';

export class VerifyJambDto {
  @ApiProperty({ description: 'Catalog JAMB product id (UTME PIN variation)' })
  @IsMongoId()
  productId: string;

  @ApiProperty({ description: 'JAMB profile ID (from the official JAMB portal)' })
  @IsString()
  @MinLength(4)
  profileId: string;
}

export class BuyJambDto {
  @ApiProperty({ description: 'Catalog JAMB product id (UTME PIN variation)' })
  @IsMongoId()
  productId: string;

  @ApiProperty({ description: 'JAMB profile ID (from the official JAMB portal)' })
  @IsString()
  @MinLength(4)
  profileId: string;

  @ApiProperty({ example: '1234', description: '4-digit transaction PIN authorising this purchase' })
  @IsString()
  @Matches(TRANSACTION_PIN_REGEX, { message: 'Transaction PIN must be exactly 4 digits' })
  pin?: string;
}