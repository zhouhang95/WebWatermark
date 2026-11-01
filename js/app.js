/* Application controller: photo list, preview scheduling, inspector binding, export. */
(function () {
  const EW = window.EW;
  const ui = EW.ui;

  const state = {
    settings: EW.loadSettings(),
    photos: [],
    selectionId: null,
    exporting: false,
    cancelled: false,
    dirHandle: null,
    previewToken: 0,
    previewTimer: 0,
    previewUrl: null,
    previewPhotoId: null,
    rendering: false
  };

  const app = (EW.app = { state: state });

  function h(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'class') node.className = props[key];
        else if (key === 'text') node.textContent = props[key];
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), props[key]);
        else if (props[key] === true) node.setAttribute(key, '');
        else if (props[key] !== false && props[key] != null) node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------------- status ---------------- */

  function updateStatus(text) {
    $('status-text').textContent = text;
  }

  function tick(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms || 16); });
  }

  /* ---------------- photo list ---------------- */

  app.selectedPhoto = function () {
    return state.photos.find(function (p) { return p.id === state.selectionId; }) || null;
  };

  function formatSize(photo) {
    return photo.width + ' × ' + photo.height;
  }

  function renderList() {
    const list = $('photo-list');
    list.innerHTML = '';
    $('photo-count').textContent = state.photos.length;
    if (!state.photos.length) {
      list.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'empty-ico', html: '<svg viewBox="0 0 48 48" width="44" height="44"><rect x="6" y="10" width="36" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 30l9-8 7 6 6-5 14 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="16" cy="19" r="3" fill="currentColor"/></svg>' }),
        h('p', { text: '还没有照片' }),
        h('span', { text: '添加图片，或把照片拖进来' })
      ]));
    } else {
      state.photos.forEach(function (photo) {
        list.appendChild(buildRow(photo));
      });
    }
    updateListStats();
  }

  function buildRow(photo) {
    const thumb = h('img', { class: 'photo-thumb', src: photo.fileUrl, alt: '' });
    const stateNode = h('div', { class: 'photo-state' });
    const bar = h('div', { class: 'bar' }, [h('i')]);
    bar.hidden = true;
    const row = h('div', {
      class: 'photo-item' + (photo.id === state.selectionId ? ' active' : ''),
      onclick: function () {
        if (state.selectionId === photo.id) return;
        state.selectionId = photo.id;
        markActive();
        schedulePreview();
      }
    }, [
      thumb,
      h('div', { class: 'photo-meta' }, [
        h('div', { class: 'photo-name', text: photo.name, title: photo.name }),
        h('div', { class: 'photo-sub' }, [h('span', { text: formatSize(photo) })]),
        stateNode,
        bar
      ]),
      h('button', {
        class: 'item-remove',
        text: '✕',
        title: '移除',
        onclick: function (event) {
          event.stopPropagation();
          removePhoto(photo);
        }
      })
    ]);
    photo._nodes = { row: row, state: stateNode, bar: bar };
    paintRow(photo);
    return row;
  }

  function paintRow(photo) {
    const nodes = photo._nodes;
    if (!nodes) return;
    const label = photo.state;
    nodes.state.textContent = label;
    nodes.state.className = 'photo-state' + (photo.failed ? ' error' : photo.output ? ' done' : '');
    const busy = photo.progress > 0 && photo.progress < 1;
    nodes.bar.hidden = !busy;
    if (busy) nodes.bar.firstChild.style.width = Math.round(photo.progress * 100) + '%';
  }

  function markActive() {
    state.photos.forEach(function (photo) {
      if (photo._nodes) {
        photo._nodes.row.classList.toggle('active', photo.id === state.selectionId);
      }
    });
  }

  function updateListStats() {
    const done = state.photos.filter(function (p) { return p.output; }).length;
    $('list-stats').textContent = state.photos.length + ' 张 · 已导出 ' + done + ' 张';
    $('btn-export').disabled = state.exporting ? false : state.photos.length === 0;
    $('btn-clear').disabled = state.exporting || state.photos.length === 0;
  }

  function removePhoto(photo) {
    if (state.exporting) return;
    const index = state.photos.indexOf(photo);
    if (index < 0) return;
    state.photos.splice(index, 1);
    if (photo.fileUrl) URL.revokeObjectURL(photo.fileUrl);
    if (photo._nodes && photo._nodes.row.parentNode) photo._nodes.row.parentNode.removeChild(photo._nodes.row);
    if (state.selectionId === photo.id) {
      const next = state.photos[Math.min(index, state.photos.length - 1)];
      state.selectionId = next ? next.id : null;
      renderList();
      schedulePreview();
    } else {
      renderList();
    }
  }

  /* ---------------- import ---------------- */

  async function addFiles(fileList) {
    if (state.exporting) {
      ui.toast('导出进行中，请稍候', 'error');
      return;
    }
    const files = Array.prototype.slice.call(fileList || []).filter(function (file) {
      return /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);
    });
    if (!files.length) {
      ui.toast('没有找到可用的图片文件', 'error');
      return;
    }

    let added = 0;
    const failures = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      updateStatus('正在读取 ' + file.name + '（' + (i + 1) + '/' + files.length + '）');
      if (state.photos.some(function (p) { return p.file === file; })) continue;
      try {
        const bitmap = await EW.decodeImage(file);
        const meta = await EW.readMetadata(file);
        const photo = {
          id: EW.uid(),
          file: file,
          name: file.name,
          width: bitmap.width,
          height: bitmap.height,
          meta: meta,
          source: null,
          fileUrl: URL.createObjectURL(file),
          state: '等待生成',
          progress: 0,
          failed: false,
          output: null
        };
        if (bitmap.close) bitmap.close();
        state.photos.push(photo);
        added++;
        if (!state.selectionId) state.selectionId = photo.id;
      } catch (e) {
        failures.push(file.name + '：' + (e && e.message ? e.message : '无法读取'));
      }
    }

    renderList();
    schedulePreview();
    updateStatus('共 ' + state.photos.length + ' 张照片' + (added ? '，新增 ' + added + ' 张' : ''));
    if (failures.length) ui.toast(failures.join('；'), 'error');

    if (state.settings.quickExport && state.photos.length) {
      exportAll();
    }
  }

  /* ---------------- preview ---------------- */

  function setPreviewVisible(visible) {
    $('preview-img').hidden = !visible;
    $('drop-hint').hidden = visible;
    $('preview-badge').hidden = !visible;
  }

  function showPreviewUrl(url, badge) {
    const img = $('preview-img');
    if (state.previewUrl && state.previewUrl !== url) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = url;
    img.src = url;
    $('preview-badge').textContent = badge;
    setPreviewVisible(true);
  }

  function showOriginal(photo, badge) {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
    }
    const img = $('preview-img');
    img.src = photo.fileUrl;
    $('preview-badge').textContent = badge;
    setPreviewVisible(true);
  }

  /* Preview sources are decoded on demand and only the selected photo keeps its
     pixels around, which keeps memory flat for large batches. */
  async function ensureSource(photo) {
    if (photo.source) return photo.source;
    const bitmap = await EW.decodeImage(photo.file);
    let source = EW.scaleDown(bitmap, 1600);
    if (source === bitmap) {
      // Small images are used as-is, so copy them before releasing the bitmap.
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      source = canvas;
    }
    if (bitmap.close) bitmap.close();
    photo.source = source;
    state.photos.forEach(function (other) {
      if (other !== photo) other.source = null;
    });
    return photo.source;
  }

  function schedulePreview(immediate) {
    state.previewToken++;
    const token = state.previewToken;
    clearTimeout(state.previewTimer);
    $('preview-busy').hidden = true;

    const photo = app.selectedPhoto();
    if (!photo) {
      setPreviewVisible(false);
      if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = null;
      }
      return;
    }

    if (!state.settings.preview) {
      showOriginal(photo, '原图');
      return;
    }

    // Keep the previous preview on screen while the new one renders, so dragging a
    // slider does not flash back to the untouched photo. Switch only when the photo changes.
    if (!state.previewUrl || state.previewPhotoId !== photo.id) {
      showOriginal(photo, '印框预览');
      state.previewPhotoId = null;
    }

    state.previewTimer = setTimeout(function () {
      if (token !== state.previewToken) return;
      $('preview-busy').hidden = false;
      // Yield so the busy indicator paints before the synchronous render.
      setTimeout(async function () {
        if (token !== state.previewToken) return;
        try {
          const source = await ensureSource(photo);
          if (token !== state.previewToken) return;
          const settings = EW.clone(state.settings);
          const result = EW.renderFrame({
            source: source,
            iw: photo.width,
            ih: photo.height,
            metadata: photo.meta,
            settings: settings,
            preview: true
          });
          if (token !== state.previewToken) return;
          const blob = await new Promise(function (resolve) { result.canvas.toBlob(resolve, 'image/jpeg', 0.85); });
          if (!blob || token !== state.previewToken) return;
          $('preview-busy').hidden = true;
          showPreviewUrl(URL.createObjectURL(blob), '印框预览');
          state.previewPhotoId = photo.id;
        } catch (e) {
          if (token !== state.previewToken) return;
          $('preview-busy').hidden = true;
          showOriginal(photo, '原图');
          ui.toast('预览失败：' + (e && e.message ? e.message : e), 'error');
        }
      }, 0);
    }, immediate ? 20 : 300);
  }

  /* ---------------- export ---------------- */

  app.settingsChanged = function (immediate) {
    EW.saveSettings(state.settings);
    syncConditionals();
    schedulePreview(immediate);
  };

  async function pickDirectory() {
    if (!supportsDirectoryOutput()) return null;
    const handle = await window.showDirectoryPicker({ id: 'easywatermark-output', mode: 'readwrite' });
    state.dirHandle = handle;
    $('output-name').textContent = handle.name;
    $('output-name').title = handle.name;
    return handle;
  }

  async function fileExists(dir, name) {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function uniqueName(fileName, used) {
    const base = fileName.replace(/\.[^.]+$/, '') + '-印框';
    let name = base + '.jpg';
    let index = 1;
    while (used.has(name) || (state.dirHandle && await fileExists(state.dirHandle, name))) {
      name = base + '-' + index + '.jpg';
      index++;
    }
    used.add(name);
    return name;
  }

  function supportsDirectoryOutput() {
    return typeof window.showDirectoryPicker === 'function';
  }

  function showBrowserGate() {
    $('browser-gate').hidden = false;
  }

  async function exportAll() {
    if (state.exporting || !state.photos.length) return;

    if (!supportsDirectoryOutput()) {
      showBrowserGate();
      return;
    }

    if (!state.dirHandle) {
      try {
        const handle = await pickDirectory();
        if (!handle) {
          updateStatus('已取消导出 · 重新点击「生成印框」可再选择输出文件夹');
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') {
          updateStatus('已取消导出');
          return;
        }
        ui.toast('无法访问输出文件夹：' + (e && e.message ? e.message : '未知错误'), 'error');
        updateStatus('无法访问输出文件夹，请重新选择');
        return;
      }
    }

    state.exporting = true;
    state.cancelled = false;
    setExportMode();
    const settings = EW.clone(state.settings);
    const folder = state.dirHandle;
    const used = new Set();
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < state.photos.length; i++) {
      if (state.cancelled) break;
      const photo = state.photos[i];
      photo.failed = false;
      photo.output = null;
      photo.state = '正在生成…';
      photo.progress = 0.15;
      paintRow(photo);
      updateStatus('正在生成 ' + (i + 1) + '/' + state.photos.length + '：' + photo.name);
      await tick();

      try {
        const bitmap = await EW.decodeImage(photo.file);
        let result;
        try {
          result = EW.renderFrame({
            source: bitmap,
            iw: photo.width,
            ih: photo.height,
            metadata: photo.meta,
            settings: settings,
            preview: false
          });
        } finally {
          if (bitmap.close) bitmap.close();
        }
        const blob = await EW.canvasToBlob(result.canvas, settings.quality);
        const name = await uniqueName(photo.name, used);
        const handle = await folder.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        photo.output = name;
        photo.progress = 1;
        photo.state = '已导出 · ' + Math.round(result.fullWidth) + '×' + Math.round(result.fullHeight);
        ok++;
      } catch (e) {
        photo.progress = 0;
        photo.failed = true;
        photo.state = e && e.message ? e.message : '生成失败';
        fail++;
      }
      paintRow(photo);
      updateListStats();
      updateStatus('已成功 ' + ok + ' 张，失败 ' + fail + ' 张');
      await tick(20);
    }

    state.exporting = false;
    setExportMode();
    updateListStats();

    if (ok > 0) {
      ui.toast('已导出 ' + ok + ' 张到「' + folder.name + '」', 'success');
      updateStatus('已导出 ' + ok + ' 张到「' + folder.name + '」' + (fail ? '，失败 ' + fail + ' 张' : ''));
    } else if (!state.cancelled) {
      updateStatus('没有生成任何图片');
    }

    if (state.cancelled) updateStatus('已停止 · 成功 ' + ok + ' 张，失败 ' + fail + ' 张');
  }

  function setExportMode() {
    const button = $('btn-export');
    const label = button.querySelector('span');
    if (state.exporting) {
      button.classList.remove('primary');
      button.classList.add('stop');
      label.textContent = '停止';
      button.disabled = false;
    } else {
      button.classList.add('primary');
      button.classList.remove('stop');
      label.textContent = '生成印框';
      button.disabled = state.photos.length === 0;
    }
    $('btn-add').disabled = state.exporting;
    $('btn-clear').disabled = state.exporting || state.photos.length === 0;
    document.body.classList.toggle('exporting', state.exporting);
  }

  /* ---------------- inspector binding ---------------- */

  function bindRange(id, key) {
    const range = $(id);
    const number = $(id + '-num');
    if (!range || !number) return;
    range.addEventListener('input', function () {
      const value = parseFloat(range.value);
      state.settings[key] = value;
      number.value = value;
      app.settingsChanged();
    });
    number.addEventListener('input', function () {
      let value = parseFloat(number.value);
      if (!Number.isFinite(value)) return;
      value = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), value));
      state.settings[key] = value;
      range.value = value;
      app.settingsChanged();
    });
    number.addEventListener('blur', function () {
      number.value = state.settings[key];
    });
  }

  function bindToggle(id, key) {
    const input = $(id);
    if (!input) return;
    input.addEventListener('change', function () {
      state.settings[key] = input.checked;
      app.settingsChanged(true);
    });
  }

  function bindInspector() {
    bindRange('imageWidth', 'imageWidth');
    bindRange('margin', 'margin');
    bindRange('textSpacing', 'textSpacing');
    bindRange('radius', 'radius');
    bindRange('shadow', 'shadow');
    bindRange('blur', 'blur');
    bindRange('quality', 'quality');

    bindToggle('customRatio', 'customRatio');
    bindToggle('landscape', 'landscape');
    bindToggle('rounded', 'rounded');
    bindToggle('shadowEnabled', 'shadowEnabled');
    bindToggle('solid', 'solid');
    bindToggle('brandLogo', 'brandLogo');
    bindToggle('preview', 'preview');
    bindToggle('quickExport', 'quickExport');

    $('ratioW').addEventListener('input', function () {
      const value = parseFloat($('ratioW').value);
      if (Number.isFinite(value) && value > 0) {
        state.settings.ratioWidth = value;
        app.settingsChanged();
      }
    });
    $('ratioH').addEventListener('input', function () {
      const value = parseFloat($('ratioH').value);
      if (Number.isFinite(value) && value > 0) {
        state.settings.ratioHeight = value;
        app.settingsChanged();
      }
    });
    $('btn-swap').addEventListener('click', function () {
      const w = state.settings.ratioWidth;
      state.settings.ratioWidth = state.settings.ratioHeight;
      state.settings.ratioHeight = w;
      syncValues();
      app.settingsChanged(true);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ratio]'), function (button) {
      button.addEventListener('click', function () {
        const parts = button.dataset.ratio.split(':');
        state.settings.ratioWidth = parseFloat(parts[0]);
        state.settings.ratioHeight = parseFloat(parts[1]);
        state.settings.customRatio = true;
        syncValues();
        app.settingsChanged(true);
      });
    });

    const colorInput = $('background');
    const hexInput = $('background-hex');
    colorInput.addEventListener('input', function () {
      state.settings.background = colorInput.value.toUpperCase();
      hexInput.value = state.settings.background;
      app.settingsChanged();
    });
    hexInput.addEventListener('change', function () {
      let value = hexInput.value.trim();
      if (!/^#/.test(value)) value = '#' + value;
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        state.settings.background = value.toUpperCase();
        colorInput.value = state.settings.background;
        hexInput.value = state.settings.background;
        app.settingsChanged(true);
      } else {
        hexInput.value = state.settings.background;
      }
    });

    $('btn-add').addEventListener('click', function () { $('file-photos').click(); });
    $('file-photos').addEventListener('change', function (event) {
      addFiles(event.target.files);
      event.target.value = '';
    });
    $('btn-clear').addEventListener('click', function () {
      if (state.exporting) return;
      state.photos.forEach(function (photo) { if (photo.fileUrl) URL.revokeObjectURL(photo.fileUrl); });
      state.photos = [];
      state.selectionId = null;
      renderList();
      schedulePreview();
      updateStatus('添加照片以开始');
    });
    $('btn-export').addEventListener('click', function () {
      if (state.exporting) {
        state.cancelled = true;
        updateStatus('正在停止，等待当前图片完成…');
        return;
      }
      exportAll();
    });
    $('btn-output').addEventListener('click', async function () {
      if (!supportsDirectoryOutput()) {
        showBrowserGate();
        return;
      }
      const handle = await pickDirectory().catch(function () { return null; });
      if (handle) ui.toast('输出文件夹已设为「' + handle.name + '」', 'success');
    });

    $('btn-templates').addEventListener('click', function () { ui.openTemplates(); });
    $('btn-fields').addEventListener('click', function () { ui.openFields(); });
    $('btn-more').addEventListener('click', function (event) {
      event.stopPropagation();
      const menu = $('menu-more');
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function () { $('menu-more').hidden = true; });
    $('menu-more').addEventListener('click', function (event) {
      const action = event.target.dataset ? event.target.dataset.action : null;
      if (!action) return;
      $('menu-more').hidden = true;
      if (action === 'font') $('file-font').click();
      if (action === 'info') ui.openMetadata();
      if (action === 'about') ui.openAbout();
      if (action === 'reset') {
        if (window.confirm('恢复默认设置？印框参数、文字模板和字段将恢复默认，已添加的照片会保留。')) {
          state.settings = EW.defaultSettings();
          EW.saveSettings(state.settings);
          syncValues();
          syncConditionals();
          schedulePreview(true);
          ui.toast('已恢复默认设置', 'success');
        }
      }
    });

    $('file-font').addEventListener('change', async function (event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const family = await EW.registerFont(file);
        ui.toast('已导入字体「' + family + '」', 'success');
        schedulePreview(true);
      } catch (e) {
        ui.toast('字体导入失败：' + (e && e.message ? e.message : e), 'error');
      }
    });

    document.addEventListener('keydown', function (event) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (!state.exporting) $('file-photos').click();
      } else if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (!state.exporting && state.photos.length) exportAll();
      }
    });

    bindDropZone();
  }

  function syncValues() {
    const s = state.settings;
    ['imageWidth', 'margin', 'textSpacing', 'radius', 'shadow', 'blur', 'quality'].forEach(function (key) {
      $(key).value = s[key];
      $(key + '-num').value = s[key];
    });
    $('customRatio').checked = s.customRatio;
    $('landscape').checked = s.landscape;
    $('rounded').checked = s.rounded;
    $('shadowEnabled').checked = s.shadowEnabled;
    $('solid').checked = s.solid;
    $('brandLogo').checked = s.brandLogo;
    $('preview').checked = s.preview;
    $('quickExport').checked = s.quickExport;
    $('ratioW').value = s.ratioWidth;
    $('ratioH').value = s.ratioHeight;
    $('background').value = s.background;
    $('background-hex').value = s.background;
  }

  function syncConditionals() {
    const s = state.settings;
    $('ratio-row').hidden = !s.customRatio;
    $('landscape-row').classList.toggle('disabled', s.customRatio);
    $('landscape').disabled = s.customRatio;
    $('radius-ctrl').hidden = !s.rounded;
    $('shadow-ctrl').hidden = !s.shadowEnabled;
    $('color-row').hidden = !s.solid;
    $('blur-ctrl').hidden = s.solid;
    $('preview-badge').textContent = s.preview ? '印框预览' : '原图';
  }

  /* ---------------- drag and drop ---------------- */

  function bindDropZone() {
    const stage = $('stage-canvas');
    let depth = 0;

    ['dragenter', 'dragover'].forEach(function (type) {
      document.addEventListener(type, function (event) {
        if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') < 0) return;
        event.preventDefault();
        if (type === 'dragenter') depth++;
        stage.classList.add('dragover');
      });
    });
    document.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (!depth) stage.classList.remove('dragover');
    });
    document.addEventListener('drop', function (event) {
      if (!event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      stage.classList.remove('dragover');
      addFiles(event.dataTransfer.files);
    });
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    if (!supportsDirectoryOutput()) {
      showBrowserGate();
      return;
    }

    bindInspector();
    syncValues();
    syncConditionals();
    renderList();
    updateListStats();
    setExportMode();

    await EW.preloadLogos();
    await EW.preloadFieldImages(state.settings);
    if (state.photos.length) schedulePreview(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
