import { Body, Controller, Get, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from '../auth/dto/auth.dto';
import { SetPinDto, VerifyPinDto } from './dto/pin.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the full profile of the authenticated user' })
  async me(@CurrentUser() user: AuthUser) {
    return this.usersService.findById(user.userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your profile' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @Get('pin/status')
  @ApiOperation({ summary: 'Whether a 4-digit transaction PIN has been set' })
  pinStatus(@CurrentUser() user: AuthUser) {
    return this.usersService.getPinStatus(user.userId);
  }

  @Post('pin')
  @ApiOperation({ summary: 'Set or change your 4-digit transaction PIN' })
  setPin(@CurrentUser() user: AuthUser, @Body() dto: SetPinDto) {
    return this.usersService.setPin(user.userId, dto.pin, dto.currentPin);
  }

  @Post('pin/verify')
  @ApiOperation({ summary: 'Verify a 4-digit transaction PIN' })
  async verifyPin(@CurrentUser() user: AuthUser, @Body() dto: VerifyPinDto) {
    const valid = await this.usersService.verifyPin(user.userId, dto.pin);
    if (!valid) {
      throw new UnauthorizedException('Incorrect transaction PIN');
    }
    return { valid };
  }
}