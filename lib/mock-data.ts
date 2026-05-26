import type {
  FarmerBlockData,
  TreatmentBlockData,
  MeteoBlockData,
  ChemicalBlockData,
} from "@/types/passport";

export const MOCK_FARMER: FarmerBlockData = {
  farmerName: "ФГ «Степ-Агро»",
  farmerId: "32456789",
  fieldArea: 56.2,
  gpsCoords: "49.5826, 34.5544",
  cadastralNumber: "5322487800:01:001:0042",
  crop: "sunflower",
};

export const MOCK_TREATMENT: TreatmentBlockData = {
  treatmentType: "herbicide",
  treatmentDate: "2026-05-15",
  treatmentTime: "07:30",
  droneModel: "DJI Agras T40",
  droneSerial: "1ZNDH4G00BA00P",
  operator: "Петренко Іван Олегович",
  pilotCert: "A2-UA-2024-001234",
  notes: "Обробка в ранкові години, вітер до 3 м/с, без опадів",
};

export const MOCK_METEO: MeteoBlockData = {
  meteoFile: {
    url: "internal://mock/meteo-2026-05-15.json",
    sha256: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    size: 1024,
    filename: "meteo-2026-05-15.json",
    contentType: "application/json",
  },
  meteoData: {
    temperatureCelsius: 18.5,
    humidityPercent: 72,
    windSpeedMps: 2.8,
    rainfallMm: 0,
    measuredAt: "2026-05-15T07:15:00.000Z",
  },
  pilotSignature: {
    keyId: "mock-key-pilot-001",
    signerName: "Петренко Іван Олегович",
    timestamp: "2026-05-15T07:20:00.000Z",
    sha256: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
    certSerial: "MOCK-CERT-PILOT-2024",
  },
};

export const MOCK_CHEMICAL: ChemicalBlockData = {
  chemical: "Раундап Макс",
  chemicalActive: "Гліфосат, 450 г/л",
  dose: 3.0,
  workingVolume: 50,
  manufacturer: "Bayer CropScience",
  regNumber: "А.02.07-12345",
  supplierName: "ТОВ «Агро-Хіміст»",
  supplierEdrpou: "12345678",
  chemFile: {
    url: "internal://mock/nakladna-2026-05-10.pdf",
    sha256: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    size: 204800,
    filename: "nakladna-2026-05-10.pdf",
    contentType: "application/pdf",
  },
  supplierSignature: {
    keyId: "mock-key-supplier-002",
    signerName: "Коваленко Сергій Миколайович",
    signerEdrpou: "12345678",
    timestamp: "2026-05-10T14:30:00.000Z",
    sha256: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
    certSerial: "MOCK-CERT-SUPPLIER-2024",
  },
};
