import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  FarmerBlockData,
  TreatmentBlockData,
  MeteoBlockData,
  ChemicalBlockData,
  MintResult,
} from "@/types/passport";
import { MOCK_FARMER, MOCK_TREATMENT, MOCK_METEO, MOCK_CHEMICAL } from "@/lib/mock-data";

export type WizardStep = 1 | 2 | 3;

interface WizardState {
  step: WizardStep;
  farmer: Partial<FarmerBlockData>;
  treatment: Partial<TreatmentBlockData>;
  meteo: Partial<MeteoBlockData>;
  chemical: Partial<ChemicalBlockData>;
  mintResult: MintResult | null;

  setStep: (step: WizardStep) => void;
  next: () => void;
  prev: () => void;

  setFarmer: (data: Partial<FarmerBlockData>) => void;
  setTreatment: (data: Partial<TreatmentBlockData>) => void;
  setMeteo: (data: Partial<MeteoBlockData>) => void;
  setChemical: (data: Partial<ChemicalBlockData>) => void;
  setMintResult: (result: MintResult) => void;

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
  mintResult: null,
  mockVersion: 0,
};

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
      setFarmer: (data) => set((s) => ({ farmer: { ...s.farmer, ...data } })),
      setTreatment: (data) => set((s) => ({ treatment: { ...s.treatment, ...data } })),
      setMeteo: (data) => set((s) => ({ meteo: { ...s.meteo, ...data } })),
      setChemical: (data) => set((s) => ({ chemical: { ...s.chemical, ...data } })),
      setMintResult: (mintResult) => set({ mintResult }),
      fillMockData: () =>
        set((s) => ({
          farmer: MOCK_FARMER,
          treatment: MOCK_TREATMENT,
          meteo: MOCK_METEO,
          chemical: MOCK_CHEMICAL,
          mockVersion: s.mockVersion + 1,
        })),
      reset: () => set(initialState),
    }),
    {
      name: "hartolit-wizard",
      partialize: (s) => ({
        step: s.step,
        farmer: s.farmer,
        treatment: s.treatment,
        // file refs are safe; signature refs are safe (just hashes)
        meteo: s.meteo,
        chemical: s.chemical,
        mintResult: s.mintResult,
      }),
    },
  ),
);
