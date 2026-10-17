-- Hotel bookings hold specific rooms, so closed dates and per-room prices apply exactly.

-- CreateTable
CREATE TABLE "booking_hotel_rooms" (
    "booking_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,

    CONSTRAINT "booking_hotel_rooms_pkey" PRIMARY KEY ("booking_id","room_id")
);

-- CreateIndex
CREATE INDEX "booking_hotel_rooms_room_id_idx" ON "booking_hotel_rooms"("room_id");

-- AddForeignKey
ALTER TABLE "booking_hotel_rooms" ADD CONSTRAINT "booking_hotel_rooms_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_hotel_rooms" ADD CONSTRAINT "booking_hotel_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

