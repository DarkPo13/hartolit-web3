import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  FarmerBlockData,
  TreatmentBlockData,
  MeteoBlockData,
  ChemicalBlockData,
  FieldPassportPayload,
  MintResult,
} from "@/types/passport";
import { MOCK_FARMER, MOCK_TREATMENT, MOCK_METEO, MOCK_CHEMICAL } from "@/lib/mock-data";

export type WizardStep = 1 | 2 | 3;

export type DraftSync = { id: string; version: number; syncedFingerprint: string; cacheDirty?: boolean };

export function draftFingerprint(state: Pick<WizardState, "farmer" | "treatment" | "meteo" | "chemical">) {
  return JSON.stringify({ farmer: state.farmer, treatment: state.treatment, meteo: state.meteo, chemical: state.chemical });
}

interface WizardState {
  step: WizardStep;
  farmer: Partial<FarmerBlockData>;
  treatment: Partial<TreatmentBlockData>;
  meteo: Partial<MeteoBlockData>;
  chemical: Partial<ChemicalBlockData>;
  pendingPayload: FieldPassportPayload | null;
  mintResult: MintResult | null;
  draftSync: DraftSync | null;

  setStep: (step: WizardStep) => void;
  next: () => void;
  prev: () => void;

  setFarmer: (data: Partial<FarmerBlockData>) => void;
  setTreatment: (data: Partial<TreatmentBlockData>) => void;
  setMeteo: (data: Partial<MeteoBlockData>) => void;
  setChemical: (data: Partial<ChemicalBlockData>) => void;
  setPendingPayload: (payload: FieldPassportPayload) => void;
  setMintResult: (result: MintResult) => void;
  replaceDraft: (data: Pick<WizardState, "farmer" | "treatment" | "meteo" | "chemical">, id: string, version: number) => void;
  setDraftSync: (draftSync: DraftSync) => void;

  mockVersion: number;
  fillMockData: () => void;

  reset: () => void;
}

const initialState = {
  step: 1 as WizardStep,
  farmer: {},
  treatment: {},
  meteo: {},
  chemical: {},
  pendingPayload: null,
  mintResult: null,
  draftSync: null,
  mockVersion: 0,
};

type PersistedWizardState = Partial<Pick<
  WizardState,
  "step" | "farmer" | "treatment" | "meteo" | "chemical" | "pendingPayload" | "mintResult" | "draftSync"
>>;

/**
 * Version 1 keeps a recoverable draft in this tab's sessionStorage. Refreshing
 * restores it, while closing the tab removes it. File references and hashes are
 * serializable; browser File objects and credentials are never stored here.
 */
export const useWizardStore = create<WizardState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setStep: (step) => set({ step }),
      next: () => {
        const { step } = get();
        if (step < 3) set({ step: (step + 1) as WizardStep });
      },
      prev: () => {
        const { step } = get();
        if (step > 1) set({ step: (step - 1) as WizardStep });
      },
      setFarmer: (data) =>
        set((s) => ({ farmer: { ...s.farmer, ...data }, pendingPayload: null, mintResult: null })),
      setTreatment: (data) =>
        set((s) => ({
          treatment: { ...s.treatment, ...data },
          pendingPayload: null,
          mintResult: null,
        })),
      setMeteo: (data) =>
        set((s) => ({ meteo: { ...s.meteo, ...data }, pendingPayload: null, mintResult: null })),
      setChemical: (data) =>
        set((s) => ({
          chemical: { ...s.chemical, ...data },
          pendingPayload: null,
          mintResult: null,
        })),
      setPendingPayload: (pendingPayload) => set({ pendingPayload }),
      setMintResult: (mintResult) => set({ mintResult }),
      replaceDraft: (data, id, version) => set((state) => ({
        ...initialState,
        ...data,
        draftSync: { id, version, syncedFingerprint: draftFingerprint(data) },
        mockVersion: state.mockVersion + 1,
      })),
      setDraftSync: (draftSync) => set({ draftSync }),
      fillMockData: () =>
        set((s) => ({
          farmer: MOCK_FARMER,
          treatment: MOCK_TREATMENT,
          meteo: MOCK_METEO,
          chemical: MOCK_CHEMICAL,
          pendingPayload: null,
          mintResult: null,
          mockVersion: s.mockVersion + 1,
        })),
      reset: () => set(initialState),
    }),
    {
      name: "hartolit-wizard-session",
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (state): PersistedWizardState => ({
        ...(state.draftSync && draftFingerprint(state) === state.draftSync.syncedFingerprint
          ? { draftSync: { ...state.draftSync, cacheDirty: false } }
          : state.draftSync ? {
        farmer: state.farmer,
        treatment: state.treatment,
        meteo: { meteoData: state.meteo.meteoData },
        chemical: Object.fromEntries(Object.entries(state.chemical).filter(([key]) => key !== "chemFile" && key !== "supplierSignature")) as Partial<ChemicalBlockData>,
        draftSync: { ...state.draftSync, cacheDirty: true },
          } : {
        step: state.step,
        farmer: state.farmer,
        treatment: state.treatment,
        meteo: state.meteo,
        chemical: state.chemical,
        pendingPayload: state.pendingPayload,
        mintResult: state.mintResult,
        draftSync: null,
          }),
      }),
      merge: (persisted, current) => {
        const restored = persisted as PersistedWizardState | undefined;
        if (!restored) return current;
        return {
          ...current,
          ...restored,
          // Do not automatically repeat a submission interrupted by refresh.
          step: restored.step === 2 && !restored.mintResult ? 1 : restored.step ?? 1,
        };
      },
    },
  ),
);
