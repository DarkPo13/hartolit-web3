import { z } from "zod";

const ukNumeric = (min: number, max: number, label: string) =>
  z
    .string()
    .min(min, `${label}: мінімум ${min} символів`)
    .max(max, `${label}: максимум ${max} символів`)
    .regex(/^[0-9]+$/, `${label}: лише цифри`);

export const farmerSchema = z.object({
  farmerName: z.string().min(2, "Введіть назву ФГ або ПІБ").max(200),
  farmerId: ukNumeric(8, 10, "ЄДРПОУ/ІПН"),
  fieldArea: z.coerce.number().positive("Площа має бути > 0").max(100000),
  gpsCoords: z
    .string()
    .min(3)
    .regex(
      /^-?\d{1,2}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/,
      "Формат GPS: lat,lng (наприклад 49.5826,34.5544)",
    ),
  cadastralNumber: z
    .string()
    .regex(
      /^\d{10}:\d{2}:\d{3}:\d{4}$/,
      "Кадастровий номер у форматі XXXXXXXXXX:XX:XXX:XXXX",
    )
    .or(z.literal("")),
  crop: z.string().min(2, "Вкажіть культуру"),
});

export const treatmentSchema = z.object({
  treatmentType: z.string().min(2),
  treatmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата у форматі YYYY-MM-DD"),
  treatmentTime: z.string().regex(/^\d{2}:\d{2}$/, "Час у форматі HH:MM"),
  droneModel: z.string().min(2, "Вкажіть модель дрона"),
  droneSerial: z.string().min(2, "Вкажіть серійний номер"),
  operator: z.string().min(2, "Вкажіть ПІБ оператора"),
  pilotCert: z.string().min(2, "Вкажіть номер ліцензії DARS"),
  notes: z.string().max(2000).optional().default(""),
});

export const meteoDataSchema = z.object({
  temperatureCelsius: z.coerce.number().min(-50).max(60),
  humidityPercent: z.coerce.number().min(0).max(100),
  windSpeedMps: z.coerce.number().min(0).max(50),
  rainfallMm: z.coerce.number().min(0).max(500),
  measuredAt: z.string(),
});

export const chemicalSchema = z.object({
  chemical: z.string().min(2, "Назва препарату"),
  chemicalActive: z.string().min(2, "Діюча речовина"),
  dose: z.coerce.number().positive("Доза > 0"),
  workingVolume: z.coerce.number().positive("Робочий об'єм > 0"),
  manufacturer: z.string().min(2, "Виробник"),
  regNumber: z.string().min(2, "№ реєстрації Укрпестицид"),
  supplierName: z.string().min(2, "Постачальник"),
  supplierEdrpou: ukNumeric(8, 10, "ЄДРПОУ постачальника"),
});

export type FarmerFormValues = z.infer<typeof farmerSchema>;
export type TreatmentFormValues = z.infer<typeof treatmentSchema>;
export type MeteoDataValues = z.infer<typeof meteoDataSchema>;
export type ChemicalFormValues = z.infer<typeof chemicalSchema>;

export const CROP_OPTIONS = [
  { value: "wheat", label: "Пшениця" },
  { value: "barley", label: "Ячмінь" },
  { value: "corn", label: "Кукурудза" },
  { value: "sunflower", label: "Соняшник" },
  { value: "soy", label: "Соя" },
  { value: "rapeseed", label: "Ріпак" },
  { value: "sugar_beet", label: "Цукровий буряк" },
  { value: "other", label: "Інше" },
] as const;

export const TREATMENT_TYPE_OPTIONS = [
  { value: "herbicide", label: "Гербіцидна обробка" },
  { value: "fungicide", label: "Фунгіцидна обробка" },
  { value: "insecticide", label: "Інсектицидна обробка" },
  { value: "fertilizer", label: "Внесення добрив" },
  { value: "desiccation", label: "Десикація" },
  { value: "other", label: "Інше" },
] as const;
