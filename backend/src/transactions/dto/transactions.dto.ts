import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ServiceType, TransactionStatus } from '../../common/enums';

export class QueryTransactionsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ServiceType })
  @IsOptional()
  @IsEnum(ServiceType)
  service?: ServiceType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;
}

export class RequeryDto {
  @ApiPropertyOptional({ description: 'Transaction reference or id' })
  @IsString()
  reference: string;
}