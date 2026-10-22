import type { publicationPublisherAccess, publicationReservations } from "./service";
import type { publicationPreparationOverview } from "./preparation";

export type PublicationReservation = Awaited<ReturnType<typeof publicationReservations>>[number];
export type PublicationAccess = ReturnType<typeof publicationPublisherAccess>;
export type PublicationPreparation = Awaited<ReturnType<typeof publicationPreparationOverview>>;
export type PublicationOverview = { reservations: PublicationReservation[]; publisher: PublicationAccess; pinning: PublicationPreparation };
