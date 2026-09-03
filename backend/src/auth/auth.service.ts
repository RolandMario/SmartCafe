import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { User } from '../users/schemas/user.schema';
import { WalletService } from '../wallet/wallet.service';
import { MailService } from '../mail/mail.service';
import { AuthTokensDto, LoginDto, RegisterDto } from './dto/auth.dto';

/** How long a password-reset code stays valid. */
const RESET_CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwtService: JwtService,
    private config: ConfigService,
    private walletService: WalletService,
    private mailService: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: User; tokens: AuthTokensDto }> {
    const exists = await this.userModel
      .findOne({ $or: [{ email: dto.email.toLowerCase() }, { phone: dto.phone }] })
      .lean();
    if (exists) {
      throw new ConflictException('An account with this email or phone already exists');
    }
    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      password: hashed,
    });
    await this.walletService.createWallet(user._id.toString());
    return { user, tokens: this.signTokens(user) };
  }

  async login(dto: LoginDto): Promise<{ user: User; tokens: AuthTokensDto }> {
    const user = await this.userModel
      .findOne({
        $or: [{ email: dto.identifier.toLowerCase() }, { phone: dto.identifier }],
      })
      .select('+password');
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account has been deactivated. Contact support.');
    }
    return { user, tokens: this.signTokens(user) };
  }

  /**
   * Issues a 6-digit reset code stored hashed on the user (expires in 15 min)
   * and "emails" it via MailService. Always returns the same generic message
   * so the response cannot be abused to enumerate registered accounts.
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.userModel.findOne({ email: email.toLowerCase() });
    if (user) {
      const code = randomInt(100000, 1000000).toString();
      user.resetPasswordToken = await bcrypt.hash(code, 10);
      user.resetPasswordExpires = new Date(Date.now() + RESET_CODE_TTL_MS);
      await user.save();
      try {
        await this.mailService.sendPasswordResetCode(user.email, code);
      } catch (err) {
        // A failed email must not break the request, but the failure should be
        // loud for support/debugging (code is still stored for 15 min).
        this.logger.error(`Failed to send password reset code to ${user.email}: ${String(err)}`);
      }
    }
    return {
      message: 'If an account exists for that email, a password reset code has been sent.',
    };
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+resetPasswordToken +resetPasswordExpires +password');
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
      throw new BadRequestException('Invalid or expired reset code');
    }
    if (user.resetPasswordExpires.getTime() < Date.now()) {
      throw new BadRequestException('This reset code has expired. Request a new one.');
    }
    if (!(await bcrypt.compare(code, user.resetPasswordToken))) {
      throw new BadRequestException('Invalid reset code');
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return { message: 'Password reset successfully. You can now sign in.' };
  }

  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.userModel.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account no longer exists or is deactivated');
    }
    return this.signTokens(user);
  }

  private signTokens(user: User): AuthTokensDto {
    const payload: any = { sub: user._id.toString(), email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') as any,
      }),
      refreshToken: this.jwtService.sign(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d') as any,
      }),
    };
  }

  async validateJwt(payload: { sub: string }) {
    const user = await this.userModel.findById(payload.sub);
    if (!user || !user.isActive) {
      return null;
    }
    return { userId: user._id.toString(), email: user.email, role: user.role };
  }
}