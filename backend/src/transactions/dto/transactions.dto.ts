import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
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

export class QueryStatsDto {
  @ApiPropertyOptional({
    description: 'Month to aggregate purchases for, e.g. 2026-09. Omit for all-time totals.',
    example: '2026-09',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like YYYY-MM' })
  month?: string;
}