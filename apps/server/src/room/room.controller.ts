import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipAuthGuard } from '../auth/skip-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../user/decorators/user.decorator';
import { JwtPayloadDto } from '../auth/dto/jwt-payload.dto';
import { RoomService } from './room.service';
import { GuestService } from './guest.service';
import { Inject } from '@nestjs/common';
import { ROOM_PRESENCE } from '../sfu/room-presence.port';
import type { RoomPresence } from '../sfu/room-presence.port';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { GuestRequestDto, GuestActionDto } from './dto/guest.dto';
import { Role } from '../generated/prisma/enums';
import { FlexibleRoomAuthGuard } from './guards/flexible-room-auth.guard';
import type { RoomIdentity } from './guards/flexible-room-auth.guard';

@ApiTags('rooms')
@Controller('rooms')
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    @Inject(ROOM_PRESENCE) private readonly presence: RoomPresence,
    private readonly guestService: GuestService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.HOST, Role.ADMIN)
  @ApiOperation({ summary: 'Create a new room' })
  async createRoom(@User() user: JwtPayloadDto, @Body() dto: CreateRoomDto) {
    return this.roomService.createRoom(user.id, dto);
  }

  @Get('history')
  @ApiOperation({ summary: "List the signed-in user's call history" })
  listCallHistory(@User() user: JwtPayloadDto) {
    return this.roomService.listCallHistory(user.id);
  }

  @Get('history/:id')
  @ApiOperation({
    summary: 'Fetch one call history record with its transcript',
  })
  getCallRecord(@User() user: JwtPayloadDto, @Param('id') id: string) {
    return this.roomService.getCallRecord(user.id, id);
  }

  @Delete('history/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a call history record' })
  async deleteCallRecord(@User() user: JwtPayloadDto, @Param('id') id: string) {
    await this.roomService.deleteCallRecord(user.id, id);
  }

  @Get(':slug')
  @SkipAuthGuard()
  @ApiOperation({ summary: 'Get room by slug' })
  async getRoomBySlug(@Param('slug') slug: string) {
    return this.roomService.findBySlug(slug);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update room (owner only)' })
  async updateRoom(
    @User() user: JwtPayloadDto,
    @Param('id') id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    const room = await this.roomService.findById(id);
    if (room.ownerId !== user.id) {
      throw new ForbiddenException('Only the owner can update this room');
    }
    return this.roomService.updateRoom(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End room (owner only)' })
  async deleteRoom(@User() user: JwtPayloadDto, @Param('id') id: string) {
    const room = await this.roomService.findById(id);
    if (room.ownerId !== user.id) {
      throw new ForbiddenException('Only the owner can end this room');
    }
    await this.roomService.softDeleteRoom(id);
    await this.presence.endRoom(id);
  }

  @Post(':slug/guest-request')
  @SkipAuthGuard()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guest requests to join a room' })
  async guestRequest(
    @Param('slug') slug: string,
    @Body() dto: GuestRequestDto,
  ) {
    const room = await this.roomService.findBySlug(slug);
    if (room.status !== 'active') {
      throw new BadRequestException('Room is not active');
    }
    if (!this.guestService.hasOwnerOnline(slug)) {
      throw new BadRequestException('Room owner is not online');
    }
    return this.guestService.createRequest(slug, dto.displayName);
  }

  @Post(':slug/guest-approve')
  @ApiOperation({ summary: 'Owner approves guest join request' })
  async guestApprove(
    @User() user: JwtPayloadDto,
    @Param('slug') slug: string,
    @Body() dto: GuestActionDto,
  ) {
    const room = await this.roomService.findBySlug(slug);
    if (room.ownerId !== user.id) {
      throw new ForbiddenException('Only the owner can approve guests');
    }
    const token = this.guestService.approveRequest(dto.requestId, slug);
    if (!token) {
      throw new NotFoundException('Request not found or expired');
    }
    return { token };
  }

  @Post(':slug/guest-deny')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Owner denies guest join request' })
  async guestDeny(
    @User() user: JwtPayloadDto,
    @Param('slug') slug: string,
    @Body() dto: GuestActionDto,
  ) {
    const room = await this.roomService.findBySlug(slug);
    if (room.ownerId !== user.id) {
      throw new ForbiddenException('Only the owner can deny guests');
    }
    const denied = this.guestService.denyRequest(dto.requestId, slug);
    if (!denied) {
      throw new NotFoundException('Request not found or expired');
    }
  }

  @Get(':slug/guest-check')
  @SkipAuthGuard()
  @ApiOperation({ summary: 'Check guest HTTP-only cookie validity' })
  async guestCheck(
    @Param('slug') slug: string,
    @Req() req: Request,
  ): Promise<{ valid: boolean; displayName?: string }> {
    const token = (req.cookies as Record<string, string>)[
      `zvonok_guest_${slug}`
    ];
    if (!token) return { valid: false };
    const result = this.guestService.validateGuestToken(token, slug);
    if (!result) return { valid: false };
    return { valid: true, displayName: result.displayName };
  }

  @Get(':slug/me')
  @SkipAuthGuard()
  @UseGuards(FlexibleRoomAuthGuard)
  @ApiOperation({ summary: 'Get current identity in the context of a room' })
  getRoomMe(@Req() req: Request): { userId: string; isGuest: boolean } {
    const identity = (req as Request & { user: RoomIdentity }).user;
    return { userId: identity.id, isGuest: identity.isGuest };
  }

  @Get(':slug/guest-status/:requestId')
  @SkipAuthGuard()
  @ApiOperation({ summary: 'Guest checks join request status' })
  async guestStatus(
    @Param('slug') slug: string,
    @Param('requestId') requestId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.guestService.getRequestStatus(requestId);
    if (!result) {
      throw new NotFoundException('Request not found or expired');
    }
    if (result.status === 'approved' && result.token) {
      res.cookie(`zvonok_guest_${slug}`, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7200 * 1000,
        path: '/',
      });
    }
    return { status: result.status };
  }
}
