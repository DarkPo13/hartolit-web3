import { z } from "zod";

export const publisherWalletSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => !/^0x0{40}$/i.test(value), "A nonzero wallet is required")
  .transform((value) => value.toLowerCase());

export const publicationReservationSchema = z.strictObject({
  confirmationId: z.uuid(),
  passportVersion: z.number().int().positive(),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  walletAddress: publisherWalletSchema,
});

export type PublicationReservationInput = z.infer<typeof publicationReservationSchema>;

export const publicationPreparationSchema = z.strictObject({
  publicationId: z.uuid(), requestId: z.uuid(), confirmationId: z.uuid(),
  passportVersion: z.number().int().positive(), expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  expectedTargetSha256: z.string().regex(/^[0-9a-f]{64}$/),
  acknowledgement: z.literal("PUBLISH_CONFIRMED_SNAPSHOT"),
});
export const publicationCancellationSchema = z.strictObject({ publicationId: z.uuid(), attemptId: z.uuid() });

export const walletChallengeInputSchema = z.strictObject({ publicationId: z.uuid() });
export const walletProofInputSchema = z.strictObject({
  publicationId: z.uuid(),
  challengeId: z.uuid(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});
export type WalletProofInput = z.infer<typeof walletProofInputSchema>;

export const walletChallengeResponseSchema = z.strictObject({
  id: z.uuid(), publicationId: z.uuid(), walletAddress: publisherWalletSchema,
  chainId: z.literal(97), message: z.string().min(1).max(4096), expiresAt: z.iso.datetime(),
});
export type WalletChallenge = z.infer<typeof walletChallengeResponseSchema>;
