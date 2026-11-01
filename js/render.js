/* Canvas renderer. Port of EasyWatermark/PhotoRenderer.swift.
   Layout is computed at original resolution; preview renders the same
   composition at a reduced scale so both paths stay consistent. */
(function () {
  const EW = (window.EW = window.EW || {});

  const MAX_SIDE = 16384;
  const MAX_AREA = 160000000;
  const FALLBACK_FAMILIES = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';

  const measureCtx = document.createElement('canvas').getContext('2d');
  const metricCache = new Map();
  const imageCache = new Map();
  const tintCache = new Map();

  /* ---------------- fonts ---------------- */

  EW.sysFonts = [
    'PingFang SC', 'Hiragino Sans GB', 'Songti SC', 'Kaiti SC', 'STHeiti',
    'Microsoft YaHei', 'SimSun', 'Noto Sans SC', 'Noto Serif SC',
    'Helvetica Neue', 'Arial', 'Avenir Next', 'DIN Alternate', 'Futura',
    'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Menlo'
  ];
  EW.importedFonts = [];

  EW.allFonts = function () {
    const seen = new Set();
    const out = [];
    EW.importedFonts.concat(EW.sysFonts).forEach(function (f) {
      if (!seen.has(f)) { seen.add(f); out.push(f); }
    });
    return out;
  };

  function cssFamily(family) {
    const name = String(family || 'PingFang SC').replace(/["\\]/g, '');
    return '"' + name + '", ' + FALLBACK_FAMILIES;
  }

  function fontString(style, size) {
    return (style.italic ? 'italic ' : '') + (style.bold ? '700' : '400') + ' ' + size.toFixed(2) + 'px ' + cssFamily(style.font);
  }

  function metrics(font, fallbackSize) {
    let m = metricCache.get(font);
    if (m) return m;
    measureCtx.font = font;
    const box = measureCtx.measureText('Hg');
    const cap = measureCtx.measureText('H');
    let ascent = box.fontBoundingBoxAscent;
    let descent = box.fontBoundingBoxDescent;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent) || (ascent <= 0 && descent <= 0)) {
      ascent = fallbackSize * 0.8;
      descent = fallbackSize * 0.2;
    }
    let capHeight = cap.actualBoundingBoxAscent;
    if (!Number.isFinite(capHeight) || capHeight <= 0) capHeight = ascent * 0.72;
    m = { ascent: ascent, descent: descent, capHeight: capHeight, lineHeight: ascent + descent };
    metricCache.set(font, m);
    return m;
  }

  function textWidth(font, text) {
    if (!text) return 0;
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }

  EW.registerFont = async function (file) {
    const buffer = await file.arrayBuffer();
    const family = guessFontFamily(buffer) || file.name.replace(/\.[^.]+$/, '');
    const face = new FontFace(family, buffer);
    await face.load();
    document.fonts.add(face);
    if (EW.importedFonts.indexOf(family) < 0) EW.importedFonts.push(family);
    metricCache.clear();
    return family;
  };

  /* Read the `name` table of a TrueType/OpenType file to recover the family name. */
  function guessFontFamily(buffer) {
    try {
      const view = new DataView(buffer);
      const tag = view.getUint32(0);
      if (tag !== 0x00010000 && tag !== 0x4f54544f) return '';
      const numTables = view.getUint16(4);
      let nameOffset = 0;
      for (let i = 0; i < numTables; i++) {
        const record = 12 + i * 16;
        if (view.getUint32(record) === 0x6e616d65) {
          nameOffset = view.getUint32(record + 8);
          break;
        }
      }
      if (!nameOffset) return '';
      const count = view.getUint16(nameOffset + 2);
      const stringOffset = nameOffset + view.getUint16(nameOffset + 4);
      let best = '';
      for (let i = 0; i < count; i++) {
        const rec = nameOffset + 6 + i * 12;
        const platformID = view.getUint16(rec);
        const nameID = view.getUint16(rec + 6);
        if (nameID !== 1 && nameID !== 4 && nameID !== 16) continue;
        const length = view.getUint16(rec + 8);
        const offset = stringOffset + view.getUint16(rec + 10);
        let value = '';
        if (platformID === 3 || platformID === 0) {
          for (let j = 0; j < length; j += 2) {
            value += String.fromCharCode(view.getUint16(offset + j));
          }
        } else if (platformID === 1) {
          for (let j = 0; j < length; j++) value += String.fromCharCode(view.getUint8(offset + j));
        }
        value = value.replace(/\u0000/g, '').trim();
        if (value && (nameID === 16 || !best)) best = value;
      }
      return best;
    } catch (e) {
      return '';
    }
  }

  /* ---------------- images ---------------- */

  function loadImage(src) {
    let entry = imageCache.get(src);
    if (entry) return entry;
    entry = new Promise(function (resolve, reject) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = src;
      imageCache.set(src + '#el', img);
    });
    imageCache.set(src, entry);
    return entry;
  }

  function loadedImage(src) {
    const img = imageCache.get(src + '#el');
    return img && img.complete && img.naturalWidth ? img : null;
  }

  EW.preloadLogos = function () {
    const logos = window.EW_LOGOS || {};
    return Promise.all(Object.keys(logos).map(function (k) {
      return loadImage(logos[k]).catch(function () { });
    }));
  };

  EW.preloadFieldImages = function (settings) {
    const jobs = [];
    (settings.fields || []).forEach(function (f) {
      if (!f.override) return;
      if (f.imageData) jobs.push(loadImage(f.imageData).catch(function () { }));
      if (f.darkImageData) jobs.push(loadImage(f.darkImageData).catch(function () { }));
    });
    return Promise.all(jobs);
  };

  function brandSource(make) {
    const value = String(make || '').toLowerCase().trim();
    if (!value) return null;
    const brands = window.EW_BRANDS || [];
    const logos = window.EW_LOGOS || {};
    const hit = brands.find(function (b) { return value.indexOf(b) >= 0; });
    return logos[hit || value.replace(/\s+/g, '')] || null;
  }

  /* Brand artwork is black; recolour it to the template text colour, the same
     way the native build tints the SVG with the label colour. */
  function tinted(src, color, heightPx) {
    const targetH = Math.max(8, Math.min(1024, Math.round(heightPx)));
    const key = targetH + '|' + color + '|' + src;
    const cached = tintCache.get(key);
    if (cached) return cached;
    const img = loadedImage(src);
    if (!img) return null;
    const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height) || 1;
    const w = Math.max(1, Math.round(targetH * aspect));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, targetH);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, targetH);
    if (tintCache.size > 120) tintCache.clear();
    tintCache.set(key, canvas);
    return canvas;
  }

  EW.decodeImage = async function (file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        try { return await createImageBitmap(file); } catch (e2) { /* fall through */ }
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise(function (resolve, reject) {
        img.onload = resolve;
        img.onerror = function () { reject(new Error('无法解码图片：' + file.name)); };
        img.src = url;
      });
      return img;
    } finally {
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }
  };

  EW.scaleDown = function (source, maxPixel) {
    const w = source.width;
    const h = source.height;
    const longest = Math.max(w, h);
    if (!longest || longest <= maxPixel) return source;
    const k = maxPixel / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  /* ---------------- template parsing ---------------- */

  function modelWithoutMake(model, make) {
    const brand = String(make || '').trim();
    const candidates = [brand, brand.split(/\s+/)[0]];
    for (let i = 0; i < candidates.length; i++) {
      const prefix = candidates[i];
      if (!prefix) continue;
      if (model.toLowerCase().indexOf(prefix.toLowerCase()) === 0) {
        const rest = model.slice(prefix.length);
        if (rest && /^\s/.test(rest)) {
          const name = rest.trim();
          if (name) return name;
        }
      }
    }
    return model;
  }

  function fieldByKey(fields, key) {
    for (let i = 0; i < fields.length; i++) if (fields[i].key === key) return fields[i];
    return null;
  }

  function applyCase(text, letterCase) {
    if (letterCase === 'upper') return text.toUpperCase();
    if (letterCase === 'lower') return text.toLowerCase();
    return text;
  }

  function resolveValues(metadata, fields) {
    const values = {};
    Object.keys(metadata || {}).forEach(function (k) {
      values[k] = metadata[k] == null ? '' : String(metadata[k]);
    });
    fields.forEach(function (f) {
      const current = values[f.key] || '';
      if (!f.visible) values[f.key] = '';
      else if (f.override && (f.force || !current)) values[f.key] = f.value || '';
    });
    return values;
  }

  function buildLine(template, fields, values, baseH, defaultColor, logoOn, darkBackground) {
    const style = template.style;
    const size = Math.max(1, baseH * Math.max(0.1, style.size) / 100);
    const font = fontString(style, size);
    const baseMetrics = metrics(font, size);
    const tokens = [];

    const content = template.content || '';
    const regex = /\{([^{}]+)\}/g;
    const matches = [];
    let found;
    while ((found = regex.exec(content)) !== null) {
      matches.push({ index: found.index, raw: found[0], expression: found[1] });
    }

    let includesMake = false;
    if (!matches.length) includesMake = false;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].expression.split('|').indexOf('Make') >= 0) includesMake = true;
    }
    const makeField = fieldByKey(fields, 'Make');
    if (!values['Make'] || (makeField && makeField.visible === false)) includesMake = false;

    let hasValue = matches.length === 0;
    let cursor = 0;

    function pushText(text, fontStr, color) {
      if (!text) return;
      tokens.push({
        type: 'text',
        text: text,
        font: fontStr,
        color: color,
        width: textWidth(fontStr, text),
        metrics: metrics(fontStr, size)
      });
    }

    matches.forEach(function (match) {
      pushText(content.slice(cursor, match.index), font, defaultColor);
      cursor = match.index + match.raw.length;

      const candidates = match.expression.split('|').map(function (s) { return s.trim(); });
      let key = null;
      for (let i = 0; i < candidates.length; i++) {
        const field = fieldByKey(fields, candidates[i]);
        const value = values[candidates[i]] || '';
        if ((!field || field.visible !== false) && (value || (field && field.override && field.imageData))) {
          key = candidates[i];
          break;
        }
      }
      if (!key) key = candidates[0] || match.expression;

      const field = fieldByKey(fields, key);
      if (field && field.visible === false) return;

      const originalValue = values[key] || '';
      let value = key === 'Model' && includesMake ? modelWithoutMake(originalValue, values['Make'] || '') : originalValue;

      let picture = null;
      const customSrc = darkBackground
        ? (field && (field.darkImageData || field.imageData))
        : (field && field.imageData);
      if (field && customSrc && field.override && (field.force || !value)) picture = customSrc;

      if (!picture && key === 'Make' && logoOn && value) {
        const candidate = brandSource(value);
        if (candidate) picture = candidate;
      }

      if (picture) {
        const img = loadedImage(picture);
        if (img) {
          const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height) || 1;
          tokens.push({
            type: 'image',
            src: picture,
            isBrand: picture !== customSrc,
            color: style.color || defaultColor,
            width: size * aspect,
            height: size,
            centered: !!template.centered,
            capHeight: baseMetrics.capHeight
          });
          hasValue = true;
          return;
        }
      }

      if (field && field.style) {
        const fieldStyle = field.style;
        const fieldSize = Math.max(1, baseH * fieldStyle.size / 100);
        const fieldFont = fontString(fieldStyle, fieldSize);
        const fieldColor = fieldStyle.color || defaultColor;
        pushText(applyCase(value, fieldStyle.letterCase), fieldFont, fieldColor);
        if (value) hasValue = true;
      } else {
        pushText(applyCase(value, style.letterCase), font, defaultColor);
        if (value) hasValue = true;
      }
    });

    pushText(content.slice(cursor), font, defaultColor);

    if (!hasValue || !tokens.length) return null;

    let width = 0;
    let height = baseMetrics.lineHeight;
    tokens.forEach(function (token) {
      width += token.width;
      const tokenHeight = token.type === 'text' ? token.metrics.lineHeight : token.height;
      if (tokenHeight > height) height = tokenHeight;
    });
    if (width <= 0) return null;

    return {
      width: width,
      height: height,
      ascent: baseMetrics.ascent,
      descent: baseMetrics.descent,
      capHeight: baseMetrics.capHeight,
      tokens: tokens
    };
  }

  /* ---------------- background ---------------- */

  function deviceCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
  }

  function drawBlurredBackground(ctx, source, w, h, sigma) {
    if (sigma <= 0.4) {
      ctx.drawImage(source, 0, 0, w, h);
      return;
    }
    const filterSupported = typeof ctx.filter === 'string';
    if (filterSupported) {
      const pad = Math.ceil(sigma * 2) + 2;
      const temp = deviceCanvas(w + pad * 2, h + pad * 2);
      const tctx = temp.getContext('2d');
      tctx.filter = 'blur(' + sigma.toFixed(2) + 'px)';
      // Stretch slightly past the edges so the blur does not fade against transparency.
      tctx.drawImage(source, 0, 0, temp.width, temp.height);
      tctx.filter = 'none';
      ctx.drawImage(temp, -pad, -pad);
      return;
    }
    // Fallback for browsers without canvas filters: downsample then upscale.
    const k = Math.max(2, Math.min(64, Math.round(sigma / 1.5)));
    const small = deviceCanvas(Math.max(1, Math.round(w / k)), Math.max(1, Math.round(h / k)));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(source, 0, 0, small.width, small.height);
    const mid = deviceCanvas(small.width, small.height);
    mid.getContext('2d').drawImage(small, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mid, 0, 0, w, h);
  }

  function roundRectPath(ctx, x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    if (r <= 0) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ---------------- main entry ---------------- */

  EW.computeLayout = function (iw, ih, settings, values) {
    const s = settings;
    let ratio = iw / ih;
    if (s.customRatio) {
      if (!(s.ratioWidth > 0) || !(s.ratioHeight > 0)) throw new Error('输出比例必须大于 0');
      ratio = s.ratioWidth / s.ratioHeight;
    } else if (s.landscape) {
      ratio = Math.max(iw, ih) / Math.min(iw, ih);
    }
    const percent = Math.max(1, Math.min(100, s.imageWidth)) / 100;
    const baseW = Math.max(iw / percent, ih * ratio);
    const baseH = baseW / ratio;

    const dark = !s.solid;
    const textColor = s.solid ? '#000000' : '#FFFFFF';
    const lines = [];
    (s.templates || []).forEach(function (template) {
      if (!template.enabled) return;
      const line = buildLine(template, s.fields || [], values, baseH, textColor, s.brandLogo !== false, dark);
      if (line) lines.push(line);
    });

    const gap = baseH * Math.max(0, s.textSpacing) / 100;
    let textHeight = 0;
    lines.forEach(function (line) { textHeight += line.height + gap * 2; });

    const shadowBlur = s.shadowEnabled ? ih * Math.max(0, s.shadow) / 100 : 0;
    const top = Math.max(baseH * Math.max(0, s.margin) / 100, shadowBlur);
    const bottom = lines.length ? baseH * 0.027 : top;
    const contentHeight = ih + top + (lines.length ? top / 2 : 0) + textHeight + bottom;

    const height = Math.max(baseH, contentHeight);
    const width = Math.max(baseW, height * ratio);

    return {
      width: width,
      height: height,
      baseW: baseW,
      baseH: baseH,
      top: top,
      gap: gap,
      lines: lines,
      shadowBlur: shadowBlur,
      imageX: (width - iw) / 2,
      imageY: (height - contentHeight) / 2 + top,
      radius: s.rounded ? ih * Math.max(0, s.radius) / 100 : 0
    };
  };

  EW.renderFrame = function (options) {
    const source = options.source;
    const iw = options.iw;
    const ih = options.ih;
    const settings = options.settings;
    const preview = !!options.preview;

    const values = resolveValues(options.metadata || {}, settings.fields || []);
    const layout = EW.computeLayout(iw, ih, settings, values);
    const W = layout.width;
    const H = layout.height;

    if (!Number.isFinite(W) || !Number.isFinite(H) || W < 1 || H < 1) throw new Error('输出尺寸无效');
    if (W > MAX_SIDE || H > MAX_SIDE || W * H > MAX_AREA) {
      throw new Error('输出尺寸过大（' + Math.round(W) + '×' + Math.round(H) + '），请提高主图占比或降低输出比例');
    }

    const scale = preview ? Math.min(1, 1500 / Math.max(W, H)) : 1;
    const canvas = deviceCanvas(W * scale, H * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建输出画布');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // ---- background ----
    if (settings.solid) {
      ctx.fillStyle = settings.background || '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      const blurRadius = Math.max(0, settings.blur) / 100 * Math.max(W, H) * 0.065;
      // Canvas blur is expressed as a standard deviation; the native build passes a
      // Core Image radius, which is roughly twice that.
      drawBlurredBackground(ctx, source, canvas.width, canvas.height, blurRadius * 0.5 * scale);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // ---- photograph, shadow and text ----
    const x = layout.imageX;
    const y = layout.imageY;

    if (layout.shadowBlur > 0) {
      // Drawn in device space so preview and export share identical shadow proportions.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = layout.shadowBlur * scale;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#000000';
      roundRectPath(ctx, x * scale, y * scale, iw * scale, ih * scale, layout.radius * scale);
      ctx.fill();
      ctx.restore();
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    roundRectPath(ctx, x, y, iw, ih, layout.radius);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, x, y, iw, ih, layout.radius);
    ctx.clip();
    ctx.drawImage(source, x, y, iw, ih);
    ctx.restore();

    let cursorY = y + ih + (layout.lines.length ? layout.top / 2 : 0);
    layout.lines.forEach(function (line) {
      cursorY += layout.gap;
      const fit = Math.min(1, W * 0.94 / Math.max(1, line.width));
      const baseline = (line.height + line.ascent - line.descent) / 2;
      ctx.save();
      ctx.translate((W - line.width * fit) / 2, cursorY);
      ctx.scale(fit, fit);
      let cursorX = 0;
      line.tokens.forEach(function (token) {
        if (token.type === 'text') {
          ctx.font = token.font;
          ctx.fillStyle = token.color;
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(token.text, cursorX, baseline);
          cursorX += token.width;
        } else {
          const deviceHeight = token.height * fit * scale;
          const picture = token.isBrand
            ? tinted(token.src, token.color, deviceHeight)
            : loadedImage(token.src);
          if (picture) {
            const topY = token.centered
              ? baseline - token.capHeight / 2 - token.height / 2
              : baseline - token.height;
            ctx.drawImage(picture, cursorX, topY, token.width, token.height);
          }
          cursorX += token.width;
        }
      });
      ctx.restore();
      cursorY += line.height + layout.gap;
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return { canvas: canvas, width: canvas.width, height: canvas.height, fullWidth: W, fullHeight: H };
  };

  EW.canvasToBlob = function (canvas, quality) {
    const q = Math.max(0.01, Math.min(1, (quality == null ? 95 : quality) / 100));
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('图片编码失败'));
        }, 'image/jpeg', q);
      } else {
        try {
          const data = canvas.toDataURL('image/jpeg', q);
          resolve(dataURLToBlob(data));
        } catch (e) {
          reject(e);
        }
      }
    });
  };

  function dataURLToBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
})();
