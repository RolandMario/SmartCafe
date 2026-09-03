import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

export enum VendorProviderName {
  MOCK = 'mock',
  VTPASS = 'vtpass',
  EBULKSMS = 'ebulksms',
}

class EnvironmentVariables {
  @IsNumber()
  PORT: number = 5000;

  @IsString()
  CORS_ORIGINS: string = '*';

  @IsNotEmpty()
  MONGODB_URI: string;

  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '30d';

  @IsOptional()
  @IsEnum(VendorProviderName)
  VENDOR_PROVIDER: VendorProviderName = VendorProviderName.MOCK;

  @IsOptional()
  @IsNumber()
  @Min(0)
  MOCK_FAILURE_RATE: number = 0;

  @IsOptional()
  @IsString()
  VTPASS_BASE_URL: string = 'https://sandbox.vtpass.com/api';

  @IsOptional()
  @IsString()
  VTPASS_API_KEY: string = '';

  @IsOptional()
  @IsString()
  VTPASS_SECRET_KEY: string = '';

  @IsOptional()
  @IsString()
  // Required for GET requests (e.g. wallet balance); POSTs use the secret key.
  VTPASS_PUBLIC_KEY: string = '';

  // --- eBulkSMS bulk SMS credentials (used when VENDOR_PROVIDER=ebulksms) ---
  // Docs: https://www.ebulksms.com/pages/api-docs
  @IsOptional()
  @IsString()
  EBULK_BASE_URL: string = 'https://api.ebulksms.com';

  @IsOptional()
  @IsString()
  EBULK_USERNAME: string = '';

  @IsOptional()
  @IsString()
  EBULK_API_KEY: string = '';

  @IsOptional()
  @IsString()
  // 0 = normal SMS, 1 = flash SMS (display only, not saved on the phone)
  EBULK_FLASH: string = '0';

  @IsOptional()
  @IsString()
  // 0 = skip DND-registered numbers (default), 1 = force delivery to DND
  EBULK_DND: string = '0';

  // --- Monnify payment gateway (wallet funding) ---
  @IsOptional()
  @IsString()
  MONNIFY_BASE_URL: string = 'https://sandbox.monnify.com';

  @IsOptional()
  @IsString()
  MONNIFY_API_KEY: string = '';

  @IsOptional()
  @IsString()
  MONNIFY_SECRET_KEY: string = '';

  @IsOptional()
  @IsString()
  MONNIFY_CONTRACT_CODE: string = '';

  @IsOptional()
  @IsString()
  MONNIFY_REDIRECT_URL: string = '';

  @IsOptional()
  @IsString()
  MONNIFY_ALLOWED_IP: string = '';

  @IsOptional()
  @IsBoolean()
  MONNIFY_WEBHOOK_INSECURE: boolean = false;

  // --- Paystack payment gateway (wallet funding) ---
  @IsOptional()
  @IsString()
  PAYSTACK_BASE_URL: string = 'https://api.paystack.co';

  @IsOptional()
  @IsString()
  PAYSTACK_SECRET_KEY: string = '';

  @IsOptional()
  @IsString()
  PAYSTACK_REDIRECT_URL: string = '';

  @IsOptional()
  @IsString()
  PAYSTACK_ALLOWED_IP: string = '';

  @IsOptional()
  @IsBoolean()
  PAYSTACK_WEBHOOK_INSECURE: boolean = false;

  // --- Email delivery (nodemailer SMTP) ---
  // Used to send password-reset verification codes. Leave SMTP_HOST empty to
  // fall back to logging the code to the server console (local dev).
  @IsOptional()
  @IsString()
  SMTP_HOST: string = '';

  @IsOptional()
  @IsNumber()
  SMTP_PORT: number = 587;

  @IsOptional()
  @IsBoolean()
  SMTP_SECURE: boolean = false;

  @IsOptional()
  @IsString()
  SMTP_USER: string = '';

  @IsOptional()
  @IsString()
  SMTP_PASS: string = '';

  @IsOptional()
  @IsString()
  // From address for outgoing mail, e.g. 'SmartCafe <no-reply@smartcafe.app>'
  MAIL_FROM: string = '';

  @IsOptional()
  @IsString()
  // Force SMTP DNS resolution to a specific address family: '4' or '6'.
  // Use '4' when the host has no working IPv6 route (Gmail resolves to both
  // families and nodemailer picks one at random, which can fail on IPv4-only
  // networks). Empty = auto (nodemailer default).
  SMTP_FAMILY: string = '';

  // Seeded admin
  @IsOptional()
  @IsString()
  ADMIN_NAME: string = 'Platform Admin';

  @IsOptional()
  @IsString()
  ADMIN_EMAIL: string = 'admin@vtuapp.com';

  @IsOptional()
  @IsString()
  ADMIN_PASSWORD: string = 'Admin@12345';

  // Seeded demo user
  @IsOptional()
  @IsString()
  DEMO_NAME: string = 'Demo User';

  @IsOptional()
  @IsString()
  DEMO_EMAIL: string = 'demo@vtuapp.com';

  @IsOptional()
  @IsString()
  DEMO_PHONE: string = '08012345678';

  @IsOptional()
  @IsString()
  DEMO_PASSWORD: string = 'Password@123';

  @IsOptional()
  @IsNumber()
  DEMO_WALLET_BALANCE: number = 50000;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
  });
  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors
        .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('\n')}`,
    );
  }
  return validated;
}