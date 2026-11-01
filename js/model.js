/* Settings model, defaults and persistence. Mirrors EasyWatermark/Models.swift. */
(function () {
  const EW = (window.EW = window.EW || {});

  EW.uid = function () {
    return 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  };

  EW.defaultStyle = function () {
    return { font: 'PingFang SC', size: 2.2, bold: false, italic: false, color: '', letterCase: 'default' };
  };

  EW.FIELDS = [
    ['PersonalSign', '个性签名'],
    ['Make', '相机厂商'],
    ['Model', '相机型号'],
    ['LensMake', '镜头厂商'],
    ['LensModel', '镜头型号'],
    ['ExposureTime', '快门'],
    ['FNumber', '光圈'],
    ['ISO', 'ISO'],
    ['FocalLength', '焦距'],
    ['FocalLengthIn35mmFormat', '等效焦距'],
    ['ExposureProgram', '拍摄档位'],
    ['DateTimeOriginal', '拍摄日期'],
    ['ExposureCompensation', '曝光补偿'],
    ['MeteringMode', '测光模式'],
    ['WhiteBalance', '白平衡']
  ];

  EW.defaultFields = function () {
    return EW.FIELDS.map(function (pair) {
      return {
        key: pair[0],
        name: pair[1],
        visible: true,
        override: false,
        force: false,
        value: '',
        custom: false,
        imageData: null,
        darkImageData: null,
        style: null
      };
    });
  };

  EW.defaultTemplates = function () {
    return [
      {
        id: 'tpl-make',
        name: 'Logo 与型号',
        content: '{Make} {Model}',
        enabled: true,
        centered: false,
        style: Object.assign(EW.defaultStyle(), { size: 3, bold: true })
      },
      {
        id: 'tpl-focal',
        name: '拍摄参数 · 优先等效焦距',
        content: '{FocalLengthIn35mmFormat|FocalLength}mm f/{FNumber} {ExposureTime}s ISO{ISO}',
        enabled: true,
        centered: false,
        style: Object.assign(EW.defaultStyle(), { size: 2.2, bold: true })
      },
      {
        id: 'tpl-raw',
        name: '拍摄参数 · 原始焦距',
        content: '{FocalLength}mm f/{FNumber} {ExposureTime}s ISO{ISO}',
        enabled: false,
        centered: false,
        style: Object.assign(EW.defaultStyle(), { size: 2.2, bold: true })
      }
    ];
  };

  EW.defaultSettings = function () {
    return {
      imageWidth: 90,
      textSpacing: 0.4,
      margin: 0,
      rounded: true,
      radius: 2.1,
      shadowEnabled: true,
      shadow: 6,
      blur: 100,
      solid: false,
      background: '#FFFFFF',
      customRatio: false,
      ratioWidth: 3,
      ratioHeight: 2,
      landscape: false,
      quality: 95,
      quickExport: false,
      preview: true,
      brandLogo: true,
      templates: EW.defaultTemplates(),
      fields: EW.defaultFields()
    };
  };

  const KEY = 'easywatermark.web.settings.v1';

  function num(value, fallback) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /* Merge a stored document onto the current defaults so newly added built-in
     fields and templates appear without discarding user customisation. */
  EW.loadSettings = function () {
    const base = EW.defaultSettings();
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return base;

    const s = Object.assign({}, base, saved);
    ['imageWidth', 'textSpacing', 'margin', 'radius', 'shadow', 'blur', 'ratioWidth', 'ratioHeight', 'quality'].forEach(function (k) {
      s[k] = num(s[k], base[k]);
    });
    ['rounded', 'shadowEnabled', 'solid', 'customRatio', 'landscape', 'quickExport', 'preview', 'brandLogo'].forEach(function (k) {
      s[k] = !!s[k];
    });
    s.background = typeof s.background === 'string' && /^#[0-9a-f]{6}$/i.test(s.background) ? s.background : '#FFFFFF';

    if (!Array.isArray(s.templates) || !s.templates.length) s.templates = base.templates;
    s.templates = s.templates.map(function (t) {
      const style = Object.assign(EW.defaultStyle(), t.style || {});
      return {
        id: t.id || EW.uid(),
        name: String(t.name || '未命名模板'),
        content: String(t.content == null ? '' : t.content),
        enabled: t.enabled !== false,
        centered: !!t.centered,
        style: style
      };
    });

    if (!Array.isArray(s.fields)) s.fields = base.fields;
    const kept = s.fields
      .filter(function (f) { return f && f.key; })
      .map(function (f) {
        return {
          key: String(f.key),
          name: String(f.name || f.key),
          visible: f.visible !== false,
          override: !!f.override,
          force: !!f.force,
          value: String(f.value == null ? '' : f.value),
          custom: !!f.custom,
          imageData: f.imageData || null,
          darkImageData: f.darkImageData || null,
          style: f.style ? Object.assign(EW.defaultStyle(), f.style) : null
        };
      });
    // Built-in fields are restored if the stored list lost them; order follows defaults.
    const byKey = {};
    kept.forEach(function (f) { byKey[f.key] = f; });
    s.fields = base.fields
      .map(function (f) { return byKey[f.key] || f; })
      .concat(kept.filter(function (f) { return !base.fields.some(function (b) { return b.key === f.key; }); }));

    return s;
  };

  let saveTimer = 0;
  EW.saveSettings = function (settings) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch (e) {
        /* storage may be full (embedded field images); keep the session running */
      }
    }, 250);
  };

  EW.clone = function (value) {
    return JSON.parse(JSON.stringify(value));
  };
})();
