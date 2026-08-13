import { z } from "zod";

const LOCAL_DATE_TIME =
  /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^(Z|[+-](\d{2}):(\d{2}))$/;

export const CoarseLocationSchema = z
  .object({
    key: z.string().min(1).max(80),
    precisionKm: z.number().positive().max(500),
  })
  .strict();

export const NormalizedExifSchema = z
  .object({
    capturedAt: z.string().max(40).nullable(),
    capturedAtLocal: z.string().max(32).nullable(),
    timezoneOffset: z.string().max(6).nullable(),
    orientation: z.number().int().min(1).max(8).nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    coarseLocation: CoarseLocationSchema.nullable(),
    warnings: z.array(z.string().min(1).max(100)).max(20),
  })
  .strict();

export type CoarseLocation = z.infer<typeof CoarseLocationSchema>;
export type NormalizedExif = z.infer<typeof NormalizedExifSchema>;

export interface ExifNormalizationOptions {
  /** Grid size in degrees. 0.1 is roughly 8–11 km in Japan. */
  coarseGridDegrees?: number;
}

type Endian = "little" | "big";

interface IfdEntry {
  type: number;
  count: number;
  dataOffset: number;
  byteLength: number;
}

/**
 * Extracts only the EXIF fields needed by Re:Memory. Exact GPS is held in local
 * variables just long enough to create a coarse grid key and is never returned.
 */
export function extractNormalizedExif(
  jpegBytes: Uint8Array,
  options: ExifNormalizationOptions = {},
): NormalizedExif {
  const warnings: string[] = [];
  const exifStart = findExifTiffStart(jpegBytes);
  if (exifStart === null) {
    return emptyExif(["exif_not_found"]);
  }

  const reader = createTiffReader(jpegBytes, exifStart);
  if (reader === null) {
    return emptyExif(["invalid_tiff_header"]);
  }

  const firstIfdRelative = reader.u32(exifStart + 4);
  const ifd0 = readIfd(reader, exifStart + firstIfdRelative);
  if (ifd0 === null) {
    return emptyExif(["invalid_ifd0"]);
  }

  const exifIfdPointer = readUnsigned(reader, ifd0.get(0x8769));
  const exifIfd =
    exifIfdPointer === null
      ? new Map<number, IfdEntry>()
      : (readIfd(reader, exifStart + exifIfdPointer) ??
        new Map<number, IfdEntry>());

  const dateTimeRaw =
    readAscii(reader, exifIfd.get(0x9003)) ??
    readAscii(reader, exifIfd.get(0x9004)) ??
    readAscii(reader, ifd0.get(0x0132));
  const offsetRaw =
    readAscii(reader, exifIfd.get(0x9011)) ??
    readAscii(reader, exifIfd.get(0x9012)) ??
    readAscii(reader, exifIfd.get(0x9010));
  const subsecondRaw =
    readAscii(reader, exifIfd.get(0x9291)) ??
    readAscii(reader, exifIfd.get(0x9290));
  const normalizedDate = normalizeExifDateTime(
    dateTimeRaw,
    offsetRaw,
    subsecondRaw,
  );

  if (dateTimeRaw !== null && normalizedDate.capturedAtLocal === null) {
    warnings.push("invalid_exif_datetime");
  }

  const orientation = boundedInteger(
    readUnsigned(reader, ifd0.get(0x0112)),
    1,
    8,
  );
  const width = positiveInteger(
    readUnsigned(reader, exifIfd.get(0xa002)) ??
      readUnsigned(reader, ifd0.get(0x0100)),
  );
  const height = positiveInteger(
    readUnsigned(reader, exifIfd.get(0xa003)) ??
      readUnsigned(reader, ifd0.get(0x0101)),
  );

  const gridDegrees = options.coarseGridDegrees ?? 0.1;
  if (!Number.isFinite(gridDegrees) || gridDegrees < 0.05 || gridDegrees > 5) {
    throw new Error("coarseGridDegrees must be between 0.05 and 5 degrees.");
  }

  const gpsIfdPointer = readUnsigned(reader, ifd0.get(0x8825));
  let coarseLocation: CoarseLocation | null = null;
  if (gpsIfdPointer !== null) {
    const gpsIfd = readIfd(reader, exifStart + gpsIfdPointer);
    if (gpsIfd === null) {
      warnings.push("invalid_gps_ifd");
    } else {
      const latitude = readGpsCoordinate(
        reader,
        gpsIfd.get(0x0002),
        readAscii(reader, gpsIfd.get(0x0001)),
        "latitude",
      );
      const longitude = readGpsCoordinate(
        reader,
        gpsIfd.get(0x0004),
        readAscii(reader, gpsIfd.get(0x0003)),
        "longitude",
      );

      if (latitude !== null && longitude !== null) {
        coarseLocation = coarsenCoordinates(latitude, longitude, gridDegrees);
      } else {
        warnings.push("invalid_gps_coordinates");
      }
    }
  }

  return NormalizedExifSchema.parse({
    ...normalizedDate,
    orientation,
    width,
    height,
    coarseLocation,
    warnings,
  });
}

export function normalizeExifDateTime(
  dateTimeRaw: string | null,
  offsetRaw: string | null,
  subsecondRaw: string | null = null,
): Pick<NormalizedExif, "capturedAt" | "capturedAtLocal" | "timezoneOffset"> {
  const match = dateTimeRaw?.trim().match(LOCAL_DATE_TIME);
  if (match === undefined || match === null) {
    return { capturedAt: null, capturedAtLocal: null, timezoneOffset: null };
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendarProbe = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );

  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day ||
    calendarProbe.getUTCHours() !== hour ||
    calendarProbe.getUTCMinutes() !== minute ||
    calendarProbe.getUTCSeconds() !== second
  ) {
    return { capturedAt: null, capturedAtLocal: null, timezoneOffset: null };
  }

  const fractionDigits = (subsecondRaw ?? "").trim().match(/^\d{1,9}$/)?.[0];
  const milliseconds = fractionDigits
    ? `.${fractionDigits.slice(0, 3).padEnd(3, "0")}`
    : "";
  const local = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${milliseconds}`;
  const offset = normalizeOffset(offsetRaw);

  return {
    capturedAt: offset === null ? null : `${local}${offset}`,
    capturedAtLocal: local,
    timezoneOffset: offset,
  };
}

export function coarsenCoordinates(
  exactLatitude: number,
  exactLongitude: number,
  gridDegrees = 0.1,
): CoarseLocation {
  if (
    !Number.isFinite(exactLatitude) ||
    !Number.isFinite(exactLongitude) ||
    exactLatitude < -90 ||
    exactLatitude > 90 ||
    exactLongitude < -180 ||
    exactLongitude > 180 ||
    !Number.isFinite(gridDegrees) ||
    gridDegrees <= 0
  ) {
    throw new Error("Valid coordinates and a positive grid size are required.");
  }

  const latitudeBucket = Math.floor((exactLatitude + 90) / gridDegrees);
  const longitudeBucket = Math.floor((exactLongitude + 180) / gridDegrees);
  const normalizedGridDegrees = Number(gridDegrees.toPrecision(12)).toString();
  const precisionKm = Math.round(gridDegrees * 111 * 10) / 10;

  // TODO(#5): Resolve this privacy-safe grid to a coarse, user-confirmable
  // place label. Never persist or send the original coordinates to the model.
  return {
    key: `grid:${latitudeBucket.toString(36)}:${longitudeBucket.toString(36)}:${normalizedGridDegrees}`,
    precisionKm,
  };
}

function emptyExif(warnings: string[]): NormalizedExif {
  return {
    capturedAt: null,
    capturedAtLocal: null,
    timezoneOffset: null,
    orientation: null,
    width: null,
    height: null,
    coarseLocation: null,
    warnings,
  };
}

function normalizeOffset(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  const match = normalized.match(OFFSET);
  if (match === null) {
    return null;
  }
  if (match[1] === "Z") {
    return "Z";
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    return null;
  }
  return match[1] ?? null;
}

function findExifTiffStart(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }
    const marker = bytes[cursor + 1];
    cursor += 2;
    if (marker === 0xd9 || marker === 0xda || marker === undefined) {
      break;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (cursor + 2 > bytes.length) {
      break;
    }
    const length = ((bytes[cursor] ?? 0) << 8) | (bytes[cursor + 1] ?? 0);
    if (length < 2 || cursor + length > bytes.length) {
      break;
    }
    if (
      marker === 0xe1 &&
      length >= 8 &&
      ascii(bytes, cursor + 2, 6) === "Exif\0\0"
    ) {
      return cursor + 8;
    }
    cursor += length;
  }

  return null;
}

function createTiffReader(bytes: Uint8Array, tiffStart: number) {
  const byteOrder = ascii(bytes, tiffStart, 2);
  const endian: Endian = byteOrder === "II" ? "little" : "big";
  if (
    (byteOrder !== "II" && byteOrder !== "MM") ||
    tiffStart + 8 > bytes.length
  ) {
    return null;
  }

  const reader = {
    bytes,
    tiffStart,
    endian,
    u16(offset: number): number {
      if (offset < 0 || offset + 2 > bytes.length) return 0;
      return endian === "little"
        ? (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
        : ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    },
    u32(offset: number): number {
      if (offset < 0 || offset + 4 > bytes.length) return 0;
      if (endian === "little") {
        return (
          ((bytes[offset] ?? 0) +
            (bytes[offset + 1] ?? 0) * 0x100 +
            (bytes[offset + 2] ?? 0) * 0x10000 +
            (bytes[offset + 3] ?? 0) * 0x1000000) >>>
          0
        );
      }
      return (
        ((bytes[offset] ?? 0) * 0x1000000 +
          (bytes[offset + 1] ?? 0) * 0x10000 +
          (bytes[offset + 2] ?? 0) * 0x100 +
          (bytes[offset + 3] ?? 0)) >>>
        0
      );
    },
  };

  return reader.u16(tiffStart + 2) === 42 ? reader : null;
}

type TiffReader = NonNullable<ReturnType<typeof createTiffReader>>;

function readIfd(
  reader: TiffReader,
  ifdOffset: number,
): Map<number, IfdEntry> | null {
  if (ifdOffset < reader.tiffStart || ifdOffset + 2 > reader.bytes.length) {
    return null;
  }
  const entryCount = reader.u16(ifdOffset);
  if (
    entryCount > 512 ||
    ifdOffset + 2 + entryCount * 12 > reader.bytes.length
  ) {
    return null;
  }

  const entries = new Map<number, IfdEntry>();
  for (let index = 0; index < entryCount; index += 1) {
    const offset = ifdOffset + 2 + index * 12;
    const tag = reader.u16(offset);
    const type = reader.u16(offset + 2);
    const count = reader.u32(offset + 4);
    const unitBytes = typeByteSize(type);
    const byteLength = count * unitBytes;
    if (
      unitBytes === 0 ||
      !Number.isSafeInteger(byteLength) ||
      byteLength > 65_536
    ) {
      continue;
    }
    const dataOffset =
      byteLength <= 4 ? offset + 8 : reader.tiffStart + reader.u32(offset + 8);
    if (
      dataOffset < reader.tiffStart ||
      dataOffset + byteLength > reader.bytes.length
    ) {
      continue;
    }
    entries.set(tag, { type, count, dataOffset, byteLength });
  }
  return entries;
}

function typeByteSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 7:
      return 1;
    case 3:
      return 2;
    case 4:
    case 9:
      return 4;
    case 5:
    case 10:
      return 8;
    default:
      return 0;
  }
}

function readAscii(
  reader: TiffReader,
  entry: IfdEntry | undefined,
): string | null {
  if (entry === undefined || entry.type !== 2 || entry.count > 1024) {
    return null;
  }
  return ascii(reader.bytes, entry.dataOffset, entry.byteLength)
    .replace(/\0+$/u, "")
    .trim();
}

function readUnsigned(
  reader: TiffReader,
  entry: IfdEntry | undefined,
): number | null {
  if (entry === undefined || entry.count < 1) return null;
  if (entry.type === 1) return reader.bytes[entry.dataOffset] ?? null;
  if (entry.type === 3) return reader.u16(entry.dataOffset);
  if (entry.type === 4) return reader.u32(entry.dataOffset);
  return null;
}

function readRationals(
  reader: TiffReader,
  entry: IfdEntry | undefined,
): number[] | null {
  if (
    entry === undefined ||
    entry.type !== 5 ||
    entry.count < 1 ||
    entry.count > 8
  ) {
    return null;
  }
  const values: number[] = [];
  for (let index = 0; index < entry.count; index += 1) {
    const offset = entry.dataOffset + index * 8;
    const numerator = reader.u32(offset);
    const denominator = reader.u32(offset + 4);
    if (denominator === 0) return null;
    values.push(numerator / denominator);
  }
  return values;
}

function readGpsCoordinate(
  reader: TiffReader,
  entry: IfdEntry | undefined,
  reference: string | null,
  kind: "latitude" | "longitude",
): number | null {
  const values = readRationals(reader, entry);
  if (values === null || values.length < 3 || reference === null) return null;
  const upperReference = reference.toUpperCase();
  const allowed = kind === "latitude" ? ["N", "S"] : ["E", "W"];
  if (!allowed.includes(upperReference)) return null;
  const unsigned = values[0]! + values[1]! / 60 + values[2]! / 3600;
  const value =
    upperReference === "S" || upperReference === "W" ? -unsigned : unsigned;
  const limit = kind === "latitude" ? 90 : 180;
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

function positiveInteger(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value > 0 ? value : null;
}

function boundedInteger(
  value: number | null,
  min: number,
  max: number,
): number | null {
  return value !== null &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let result = "";
  for (let index = start; index < start + length; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0);
  }
  return result;
}
