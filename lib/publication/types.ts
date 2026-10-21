import type { publicationPublisherAccess, publicationReservations } from "./service";

export type PublicationReservation = Awaited<ReturnType<typeof publicationReservations>>[number];
export type PublicationAccess = ReturnType<typeof publicationPublisherAccess>;
export type PublicationOverview = { reservations: PublicationReservation[]; publisher: PublicationAccess };
