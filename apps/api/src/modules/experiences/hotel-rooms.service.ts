import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EXPERIENCE_LIMITS,
  ErrorCode,
  ExperienceStatus,
  type AgentExperienceView,
  type RoomAvailabilityView,
  type createRoomSchema,
  type createRoomTypeSchema,
  type roomAvailabilityQuerySchema,
  type updateRoomAvailabilitySchema,
  type updateRoomSchema,
  type updateRoomTypeSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PropertyAccessService } from '../properties/property-access.service';
import { AgentExperiencesService, validationError } from './agent-experiences.service';
import { ExperienceAccessService } from './experience-access.service';

type Out<T extends z.ZodType> = z.output<T>;

/**
 * A hotel's room types, rooms and per-room, per-date availability (§25).
 * Catalogue information only: it shows what exists and the listed nightly
 * prices; nothing is held, reserved or sold.
 *
 * Room types (names, descriptions, prices) are public content, so changing
 * them sends a published hotel back to review. Rooms and availability are
 * day-to-day operations and do not.
 */
@Injectable()
export class HotelRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: PropertyAccessService,
    private readonly access: ExperienceAccessService,
    private readonly experiences: AgentExperiencesService,
  ) {}

  async createRoomType(
    userId: string,
    id: string,
    input: Out<typeof createRoomTypeSchema>,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    return this.hotelEdit(userId, id, meta, 'experience.room_type_created', async (tx, hotel) => {
      const types = hotel.hotel!.roomTypes;
      if (types.length >= EXPERIENCE_LIMITS.roomTypes) {
        throw tooMany(`A hotel can have at most ${EXPERIENCE_LIMITS.roomTypes} room types.`);
      }
      assertUniqueName(types, input.name);
      await tx.hotelRoomType.create({
        data: {
          hotelId: id,
          name: input.name,
          description: input.description ?? null,
          maxGuests: input.maxGuests ?? null,
          priceKobo: BigInt(input.priceKobo),
          sortOrder: types.length,
        },
      });
      return true;
    });
  }

  async updateRoomType(
    userId: string,
    id: string,
    roomTypeId: string,
    input: Out<typeof updateRoomTypeSchema>,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    return this.hotelEdit(userId, id, meta, 'experience.room_type_updated', async (tx, hotel) => {
      const types = hotel.hotel!.roomTypes;
      if (!types.some((t) => t.id === roomTypeId)) throw Errors.notFound('Room type');
      if (input.name) assertUniqueName(types, input.name, roomTypeId);
      await tx.hotelRoomType.update({
        where: { id: roomTypeId },
        data: {
          name: input.name,
          description: input.description,
          maxGuests: input.maxGuests,
          priceKobo: input.priceKobo === undefined ? undefined : BigInt(input.priceKobo),
        },
      });
      return true;
    });
  }

  async deleteRoomType(
    userId: string,
    id: string,
    roomTypeId: string,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    return this.hotelEdit(userId, id, meta, 'experience.room_type_deleted', async (tx, hotel) => {
      const types = hotel.hotel!.roomTypes;
      if (!types.some((t) => t.id === roomTypeId)) throw Errors.notFound('Room type');
      if (hotel.hotel!.rooms.some((r) => r.roomTypeId === roomTypeId)) {
        throw Errors.conflict('Move or delete the rooms of this type first.');
      }
      if (hotel.status === ExperienceStatus.PUBLISHED && types.length === 1) {
        throw Errors.conflict('A published hotel needs at least one room type.');
      }
      await tx.hotelRoomType.delete({ where: { id: roomTypeId } });
      return true;
    });
  }

  async createRoom(
    userId: string,
    id: string,
    input: Out<typeof createRoomSchema>,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    return this.hotelEdit(userId, id, meta, 'experience.room_created', async (tx, hotel) => {
      const { roomTypes, rooms } = hotel.hotel!;
      if (rooms.length >= EXPERIENCE_LIMITS.rooms) {
        throw tooMany(`A hotel can have at most ${EXPERIENCE_LIMITS.rooms} rooms.`);
      }
      // The room type must belong to *this* hotel — never trust a foreign id.
      if (!roomTypes.some((t) => t.id === input.roomTypeId)) {
        throw validationError('roomTypeId', 'Choose one of this hotel’s room types');
      }
      assertUniqueLabel(rooms, input.label);
      await tx.hotelRoom.create({
        data: {
          hotelId: id,
          roomTypeId: input.roomTypeId,
          label: input.label,
          priceKobo:
            input.priceKobo === undefined || input.priceKobo === null
              ? null
              : BigInt(input.priceKobo),
          active: input.active ?? true,
        },
      });
      return false;
    });
  }

  async updateRoom(
    userId: string,
    id: string,
    roomId: string,
    input: Out<typeof updateRoomSchema>,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    return this.hotelEdit(userId, id, meta, 'experience.room_updated', async (tx, hotel) => {
      const { roomTypes, rooms } = hotel.hotel!;
      if (!rooms.some((r) => r.id === roomId)) throw Errors.notFound('Room');
      if (input.roomTypeId && !roomTypes.some((t) => t.id === input.roomTypeId)) {
        throw validationError('roomTypeId', 'Choose one of this hotel’s room types');
      }
      if (input.label) assertUniqueLabel(rooms, input.label, roomId);
      await tx.hotelRoom.update({
        where: { id: roomId },
        data: {
          roomTypeId: input.roomTypeId,
          label: input.label,
          priceKobo:
            input.priceKobo === undefined
              ? undefined
              : input.priceKobo === null
                ? null
                : BigInt(input.priceKobo),
          active: input.active,
        },
      });
      return false;
    });
  }

  async deleteRoom(
    userId: string,
    id: string,
    roomId: string,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    return this.hotelEdit(userId, id, meta, 'experience.room_deleted', async (tx, hotel) => {
      if (!hotel.hotel!.rooms.some((r) => r.id === roomId)) throw Errors.notFound('Room');
      await tx.hotelRoom.delete({ where: { id: roomId } });
      return false;
    });
  }

  /** Date overrides of every room in a window (owner view). */
  async availability(
    userId: string,
    id: string,
    query: Out<typeof roomAvailabilityQuerySchema>,
  ): Promise<RoomAvailabilityView> {
    const agent = await this.agents.agentFor(userId);
    const hotel = await this.access.owned(agent.id, id);
    this.access.assertKind(hotel, 'HOTEL');
    const overrides = await this.prisma.hotelRoomAvailability.findMany({
      where: {
        room: { hotelId: id },
        date: { gte: new Date(query.from), lte: new Date(query.to) },
      },
      orderBy: { date: 'asc' },
    });
    const typePrice = new Map(hotel.hotel!.roomTypes.map((t) => [t.id, t.priceKobo]));
    return {
      from: query.from,
      to: query.to,
      rooms: hotel.hotel!.rooms.map((room) => ({
        roomId: room.id,
        label: room.label,
        roomTypeId: room.roomTypeId,
        active: room.active,
        defaultPriceKobo: Number(room.priceKobo ?? typePrice.get(room.roomTypeId) ?? 0n),
        overrides: overrides
          .filter((o) => o.roomId === room.id)
          .map((o) => ({
            date: o.date.toISOString().slice(0, 10),
            available: o.available,
            priceKobo: o.priceKobo === null ? null : Number(o.priceKobo),
          })),
      })),
    };
  }

  /** Sets or clears one room's date overrides. Past dates cannot be changed. */
  async setAvailability(
    userId: string,
    id: string,
    roomId: string,
    input: Out<typeof updateRoomAvailabilitySchema>,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const today = new Date().toISOString().slice(0, 10);
    const dates = [...input.set.map((s) => s.date), ...input.clear];
    if (dates.some((d) => d < today)) {
      throw validationError('date', 'Past dates cannot be changed');
    }
    return this.hotelEdit(userId, id, meta, 'experience.room_availability_set', async (tx, h) => {
      if (!h.hotel!.rooms.some((r) => r.id === roomId)) throw Errors.notFound('Room');
      if (input.clear.length) {
        await tx.hotelRoomAvailability.deleteMany({
          where: { roomId, date: { in: input.clear.map((d) => new Date(d)) } },
        });
      }
      for (const day of input.set) {
        const values = {
          available: day.available,
          priceKobo: day.priceKobo == null ? null : BigInt(day.priceKobo),
        };
        await tx.hotelRoomAvailability.upsert({
          where: { roomId_date: { roomId, date: new Date(day.date) } },
          create: { roomId, date: new Date(day.date), ...values },
          update: values,
        });
      }
      return false;
    });
  }

  private async hotelEdit(
    userId: string,
    id: string,
    meta: RequestMeta,
    action: string,
    change: Parameters<AgentExperiencesService['edit']>[5],
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    return this.experiences.edit(userId, agent, id, meta, action, async (tx, current) => {
      this.access.assertKind(current, 'HOTEL');
      return change(tx, current);
    });
  }
}

function assertUniqueName(types: { id: string; name: string }[], name: string, except?: string) {
  if (types.some((t) => t.id !== except && t.name.toLowerCase() === name.toLowerCase())) {
    throw validationError('name', 'This hotel already has a room type with this name');
  }
}

function assertUniqueLabel(rooms: { id: string; label: string }[], label: string, except?: string) {
  if (rooms.some((r) => r.id !== except && r.label.toLowerCase() === label.toLowerCase())) {
    throw validationError('label', 'This hotel already has a room with this name or number');
  }
}

const tooMany = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
