/* EXIF reading and formatting. Mirrors the field formatting of PhotoRenderer.load(). */
(function () {
  const EW = (window.EW = window.EW || {});

  const PARSE_OPTIONS = {
    tiff: true,
    exif: true,
    gps: false,
    interop: false,
    ifd1: false,
    makerNote: false,
    userComment: false,
    xmp: false,
    icc: false,
    iptc: false,
    jfif: false,
    ihdr: false,
    translateKeys: true,
    translateValues: false,
    reviveValues: false,
    mergeOutput: true,
    silentErrors: true
  };

  const EXPOSURE_PROGRAM = {
    0: '未定义', 1: '手动', 2: '程序自动', 3: '光圈优先', 4: '快门优先',
    5: '景深优先', 6: '运动', 7: '肖像', 8: '风景'
  };
  const METERING_MODE = {
    0: '未知', 1: '平均测光', 2: '中央重点', 3: '点测光',
    4: '多点测光', 5: '评价测光', 6: '局部测光', 255: '其他'
  };
  const WHITE_BALANCE = { 0: '自动', 1: '手动' };

  function first(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function trimNumber(n, decimals) {
    if (!Number.isFinite(n)) return '';
    const factor = Math.pow(10, decimals == null ? 2 : decimals);
    const rounded = Math.round(n * factor) / factor;
    return String(rounded);
  }

  function asNumber(value) {
    const v = first(value);
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const fraction = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (fraction) {
        const denominator = parseFloat(fraction[2]);
        return denominator ? parseFloat(fraction[1]) / denominator : NaN;
      }
      return parseFloat(v);
    }
    if (Array.isArray(v)) return asNumber(v);
    if (v && typeof v === 'object' && typeof v.numerator === 'number' && typeof v.denominator === 'number') {
      return v.denominator ? v.numerator / v.denominator : NaN;
    }
    return NaN;
  }

  function asText(value) {
    const v = first(value);
    if (v == null) return '';
    if (v instanceof Date) return formatDate(v);
    if (Array.isArray(v)) return asText(v[0]);
    return String(v).trim();
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(value) {
    if (value instanceof Date && !isNaN(value)) {
      return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate()) +
        ' ' + pad(value.getHours()) + ':' + pad(value.getMinutes());
    }
    const text = String(value).trim();
    // EXIF stores "2024:05:01 12:33:10"; normalise to a readable form.
    const m = text.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
    const d = text.match(/^(\d{4}):(\d{2}):(\d{2})$/);
    if (d) return d[1] + '-' + d[2] + '-' + d[3];
    return text;
  }

  function formatExposureTime(raw) {
    const n = asNumber(raw);
    if (!Number.isFinite(n) || n <= 0) return asText(raw);
    if (n < 1) return '1/' + Math.round(1 / n);
    return trimNumber(n, 2);
  }

  EW.mapMetadata = function (raw) {
    const meta = {};
    if (!raw) return meta;

    meta.Make = asText(raw.Make);
    meta.Model = asText(raw.Model);
    meta.LensMake = asText(raw.LensMake);
    meta.LensModel = asText(raw.LensModel);
    meta.DateTimeOriginal = formatDate(first(raw.DateTimeOriginal) || first(raw.CreateDate) || first(raw.ModifyDate) || '');

    const fnumber = asNumber(raw.FNumber);
    meta.FNumber = Number.isFinite(fnumber) ? trimNumber(fnumber, 1) : '';

    const focal = asNumber(raw.FocalLength);
    meta.FocalLength = Number.isFinite(focal) ? trimNumber(focal, 1) : '';

    // exifr exposes the 35mm equivalent under different aliases depending on version.
    const focal35Keys = ['FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm', 'FocalLenIn35mmFilm'];
    let focal35Raw = null;
    for (let i = 0; i < focal35Keys.length; i++) {
      if (raw[focal35Keys[i]] != null) { focal35Raw = raw[focal35Keys[i]]; break; }
    }
    const focal35 = asNumber(focal35Raw);
    meta.FocalLengthIn35mmFormat = Number.isFinite(focal35) ? trimNumber(focal35, 0) : '';

    const iso = asNumber(raw.ISO != null ? raw.ISO : raw.ISOSpeedRatings);
    meta.ISO = Number.isFinite(iso) ? String(Math.round(iso)) : '';

    meta.ExposureTime = formatExposureTime(raw.ExposureTime);

    const bias = asNumber(raw.ExposureBiasValue != null ? raw.ExposureBiasValue : raw.ExposureCompensation);
    meta.ExposureCompensation = Number.isFinite(bias) ? trimNumber(bias, 1) : '';

    const program = asNumber(raw.ExposureProgram);
    meta.ExposureProgram = Number.isFinite(program) ? (EXPOSURE_PROGRAM[program] || String(program)) : '';

    const metering = asNumber(raw.MeteringMode);
    meta.MeteringMode = Number.isFinite(metering) ? (METERING_MODE[metering] || String(metering)) : '';

    const wb = asNumber(raw.WhiteBalance);
    meta.WhiteBalance = Number.isFinite(wb) ? (WHITE_BALANCE[wb] || String(wb)) : '';

    // Keep a couple of raw extras for the info panel; they are not template fields.
    if (raw.Software) meta.Software = asText(raw.Software);
    if (raw.Artist) meta.Artist = asText(raw.Artist);
    if (raw.Copyright) meta.Copyright = asText(raw.Copyright);
    if (raw.Orientation != null) meta.Orientation = String(asNumber(raw.Orientation));

    return meta;
  };

  EW.readMetadata = async function (file) {
    if (!window.exifr) return {};
    try {
      const raw = await window.exifr.parse(file, PARSE_OPTIONS);
      return EW.mapMetadata(raw);
    } catch (e) {
      return {};
    }
  };

  EW.emptyMetadata = function () {
    const meta = {};
    EW.FIELDS.forEach(function (pair) { meta[pair[0]] = ''; });
    return meta;
  };
})();
