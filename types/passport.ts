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
  meteoData: Partial<MeteoData>;
  pilotSignature?: DiiaSignatureRef;
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
  supplierSignature?: DiiaSignatureRef;
}

/** Version 1 public IPFS document. Every collected MVP field is intentionally public. */
export interface FieldPassportPayload {
  schema: "hartolit.field-passport.public";
  version: "1.0.0";
  issuedAt: string;
  farmer: FarmerBlockData;
  treatment: TreatmentBlockData;
  meteo: {
    file: FileRef;
    data: MeteoData;
  };
  chemical: {
    product: string;
    activeSubstance: string;
    dosePerHa: number;
    workingVolumeLitresPerHa: number;
    manufacturer: string;
    registrationNumber: string;
    supplierName: string;
    supplierEdrpou: string;
    file: FileRef;
  };
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
  payload: FieldPassportPayload;
}
