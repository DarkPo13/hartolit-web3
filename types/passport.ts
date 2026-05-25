export interface FileRef {
  url: string;
  sha256: string;
  size: number;
  filename: string;
  contentType: string;
}

export interface DiiaSignatureRef {
  keyId: string;
  signerName: string;
  signerEdrpou?: string;
  timestamp: string;
  sha256: string;
  certSerial?: string;
}

export interface MeteoData {
  temperatureCelsius: number;
  humidityPercent: number;
  windSpeedMps: number;
  rainfallMm: number;
  measuredAt: string;
}

export interface FarmerBlockData {
  farmerName: string;
  farmerId: string;
  fieldArea: number;
  gpsCoords: string;
  cadastralNumber: string;
  crop: string;
}

export interface TreatmentBlockData {
  treatmentType: string;
  treatmentDate: string;
  treatmentTime: string;
  droneModel: string;
  droneSerial: string;
  operator: string;
  pilotCert: string;
  notes: string;
}

export interface MeteoBlockData {
  meteoFile: FileRef;
  meteoData: MeteoData;
  pilotSignature: DiiaSignatureRef;
}

export interface ChemicalBlockData {
  chemical: string;
  chemicalActive: string;
  dose: number;
  workingVolume: number;
  manufacturer: string;
  regNumber: string;
  supplierName: string;
  supplierEdrpou: string;
  chemFile: FileRef;
  supplierSignature: DiiaSignatureRef;
}

export interface FieldPassportPayload
  extends FarmerBlockData,
    TreatmentBlockData,
    MeteoBlockData,
    ChemicalBlockData {
  timestamp: string;
  version: string;
}

export interface MintResult {
  tokenId: number;
  txHash: `0x${string}`;
  blockNumber: number;
  ipfsUri: string;
  payloadHash: `0x${string}`;
  gasUsed: string;
  contractAddress: `0x${string}`;
  chainId: number;
  mintedAt: string;
}
