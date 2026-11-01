/* Modal editors for text templates, camera fields and photo metadata. */
(function () {
  const EW = (window.EW = window.EW || {});
  const ui = (EW.ui = EW.ui || {});

  /* ---------------- tiny DOM helpers ---------------- */

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'class') node.className = props[key];
        else if (key === 'text') node.textContent = props[key];
        else if (key === 'html') node.innerHTML = props[key];
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), props[key]);
        else if (key === 'style') node.setAttribute('style', props[key]);
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

  function section(title, children) {
    return el('div', { class: 'form-sect' }, [el('h4', { text: title })].concat(children));
  }

  function row(label, control) {
    return el('div', { class: 'form-row' }, [el('label', { text: label }), el('div', { class: 'grow' }, [control])]);
  }

  function textField(value, oninput, placeholder) {
    const input = el('input', { type: 'text', value: value || '', placeholder: placeholder || '' });
    input.addEventListener('input', function () { oninput(input.value); });
    return input;
  }

  function numberField(value, min, max, step, oninput, suffix) {
    const input = el('input', { type: 'number', min: min, max: max, step: step || 0.1, value: value });
    input.addEventListener('input', function () {
      let v = parseFloat(input.value);
      if (!Number.isFinite(v)) v = min;
      v = Math.min(max, Math.max(min, v));
      oninput(v);
    });
    input.addEventListener('blur', function () { input.value = parseFloat(input.value) || min; });
    return suffix ? el('div', { class: 'inline' }, [input, el('span', { class: 'mono', text: suffix })]) : input;
  }

  function selectField(options, value, onchange) {
    const select = el('select');
    options.forEach(function (opt) {
      const option = el('option', { value: opt.value, text: opt.label });
      if (opt.value === value) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', function () { onchange(select.value); });
    return select;
  }

  function switchRow(label, checked, onchange) {
    const input = el('input', { type: 'checkbox', class: 'switch' });
    input.checked = !!checked;
    input.addEventListener('change', function () { onchange(input.checked); });
    return el('label', { class: 'switch-row' }, [el('span', { text: label }), input]);
  }

  function swatch(value, onchange) {
    const input = el('input', { type: 'color', value: value });
    input.addEventListener('input', function () { onchange(input.value.toUpperCase()); });
    return input;
  }

  function emptyHint(text) {
    return el('div', { class: 'form-empty', text: text });
  }

  /* ---------------- modal shell ---------------- */

  let closeHandler = null;

  ui.openModal = function (options) {
    const overlay = document.getElementById('overlay');
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = options.title;
    const body = document.getElementById('modal-body');
    const foot = document.getElementById('modal-foot');
    body.className = 'modal-body' + (options.padded ? ' pad' : '');
    body.innerHTML = '';
    foot.innerHTML = '';
    modal.className = 'modal' + (options.small ? ' small' : '');
    if (options.body) body.appendChild(options.body);
    (options.foot || []).forEach(function (node) { foot.appendChild(node); });
    overlay.hidden = false;
    closeHandler = options.onClose || null;
  };

  ui.closeModal = function () {
    document.getElementById('overlay').hidden = true;
    document.getElementById('modal-body').innerHTML = '';
    if (closeHandler) {
      const fn = closeHandler;
      closeHandler = null;
      fn();
    }
    EW.app.settingsChanged(true);
  };

  document.getElementById('modal-close').addEventListener('click', function () { ui.closeModal(); });
  document.getElementById('overlay').addEventListener('mousedown', function (event) {
    if (event.target.id === 'overlay') ui.closeModal();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !document.getElementById('overlay').hidden) ui.closeModal();
  });

  function doneButton(label) {
    return el('button', { class: 'btn primary', text: label || '完成', onclick: function () { ui.closeModal(); } });
  }

  /* ---------------- text templates ---------------- */

  ui.openTemplates = function () {
    const settings = EW.app.state.settings;
    let selectedId = (settings.templates[0] || {}).id;

    const listItems = el('div', { class: 'items' });
    const form = el('div', { class: 'split-form' });

    function renderList() {
      listItems.innerHTML = '';
      if (!settings.templates.length) {
        listItems.appendChild(el('div', { class: 'form-empty', text: '没有模板' }));
      }
      settings.templates.forEach(function (template) {
        const dot = el('span', { class: 'dot' + (template.enabled ? ' on' : '') });
        const label = el('span', { class: 'label', text: template.name || '未命名' });
        const item = el('div', {
          class: 'row' + (template.id === selectedId ? ' active' : ''),
          onclick: function () { selectedId = template.id; renderList(); renderForm(); }
        }, [dot, label]);
        item.dataset.id = template.id;
        listItems.appendChild(item);
      });
    }

    function current() {
      return settings.templates.find(function (t) { return t.id === selectedId; }) || null;
    }

    function renderForm() {
      form.innerHTML = '';
      const template = current();
      if (!template) {
        form.appendChild(emptyHint('选择左侧的文字模板'));
        return;
      }

      form.appendChild(section('模板', [
        switchRow('启用', template.enabled, function (value) {
          template.enabled = value;
          renderList();
          EW.app.settingsChanged();
        }),
        row('名称', textField(template.name, function (value) {
          template.name = value;
          renderList();
          EW.app.settingsChanged();
        })),
        row('内容', (function () {
          const area = el('textarea', { rows: 3 });
          area.value = template.content;
          area.addEventListener('input', function () {
            template.content = area.value;
            EW.app.settingsChanged();
          });
          return area;
        })()),
        el('div', { class: 'form-row' }, [
          el('label', { text: '插入字段' }),
          el('div', { class: 'chips grow' }, settings.fields.map(function (field) {
            return el('button', {
              class: 'chip',
              text: field.name,
              onclick: function () {
                template.content += '{' + field.key + '}';
                renderForm();
                EW.app.settingsChanged();
              }
            });
          }))
        ]),
        el('p', { class: 'form-tip', text: '使用 {字段键} 引用信息；{A|B} 优先显示 A，缺失时显示 B。文字按列表顺序显示在主图下方。' })
      ]));

      form.appendChild(section('字体', [
        row('字体', selectField(EW.allFonts().map(function (f) { return { value: f, label: f }; }), template.style.font, function (value) {
          template.style.font = value;
          EW.app.settingsChanged();
        })),
        row('字号', numberField(template.style.size, 0.1, 20, 0.1, function (value) {
          template.style.size = value;
          EW.app.settingsChanged();
        }, '%')),
        el('p', { class: 'form-tip', text: '字号按背景高度的百分比计算，2.2% 约等于成品高度的 1/45。' }),
        switchRow('粗体', template.style.bold, function (value) {
          template.style.bold = value;
          EW.app.settingsChanged();
        }),
        switchRow('斜体', template.style.italic, function (value) {
          template.style.italic = value;
          EW.app.settingsChanged();
        }),
        row('大小写', selectField([
          { value: 'default', label: '保持原样' },
          { value: 'upper', label: '大写' },
          { value: 'lower', label: '小写' }
        ], template.style.letterCase, function (value) {
          template.style.letterCase = value;
          EW.app.settingsChanged();
        })),
        switchRow('自动文字颜色', !template.style.color, function (auto) {
          template.style.color = auto ? '' : '#000000';
          renderForm();
          EW.app.settingsChanged();
        }),
        template.style.color ? row('文字颜色', swatch(template.style.color, function (value) {
          template.style.color = value;
          EW.app.settingsChanged();
        })) : null,
        switchRow('Logo 垂直居中', template.centered, function (value) {
          template.centered = value;
          EW.app.settingsChanged();
        })
      ]));
    }

    function indexOfSelected() {
      return settings.templates.findIndex(function (t) { return t.id === selectedId; });
    }

    const toolbar = el('div', { class: 'bar-row' }, [
      el('button', {
        class: 'btn tiny', text: '＋', title: '新建模板', onclick: function () {
          const template = {
            id: EW.uid(),
            name: '自定义模板',
            content: '{PersonalSign}',
            enabled: true,
            centered: false,
            style: EW.defaultStyle()
          };
          settings.templates.push(template);
          selectedId = template.id;
          renderList(); renderForm(); EW.app.settingsChanged();
        }
      }),
      el('button', {
        class: 'btn tiny', text: '−', title: '删除模板', onclick: function () {
          const index = indexOfSelected();
          if (index < 0) return;
          settings.templates.splice(index, 1);
          const next = settings.templates[Math.min(index, settings.templates.length - 1)];
          selectedId = next ? next.id : null;
          renderList(); renderForm(); EW.app.settingsChanged();
        }
      }),
      el('button', {
        class: 'btn tiny', text: '↑', title: '上移', onclick: function () {
          const index = indexOfSelected();
          if (index <= 0) return;
          const list = settings.templates;
          const swap = list[index - 1];
          list[index - 1] = list[index];
          list[index] = swap;
          renderList(); EW.app.settingsChanged();
        }
      }),
      el('button', {
        class: 'btn tiny', text: '↓', title: '下移', onclick: function () {
          const index = indexOfSelected();
          if (index < 0 || index >= settings.templates.length - 1) return;
          const list = settings.templates;
          const swap = list[index + 1];
          list[index + 1] = list[index];
          list[index] = swap;
          renderList(); EW.app.settingsChanged();
        }
      })
    ]);

    renderList();
    renderForm();

    ui.openModal({
      title: '文字模板',
      body: el('div', { class: 'split' }, [
        el('div', { class: 'split-list' }, [listItems, toolbar]),
        form
      ]),
      foot: [doneButton()]
    });
  };

  /* ---------------- camera fields ---------------- */

  function pickImageFile() {
    return new Promise(function (resolve) {
      const input = document.getElementById('file-field-image');
      input.value = '';
      input.onchange = function () { resolve(input.files && input.files[0] ? input.files[0] : null); };
      input.click();
    });
  }

  async function toFieldImage(file) {
    const bitmap = await EW.decodeImage(file);
    const scaled = EW.scaleDown(bitmap, 512);
    const canvas = document.createElement('canvas');
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    canvas.getContext('2d').drawImage(scaled, 0, 0);
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL('image/png');
  }

  ui.openFields = function () {
    const settings = EW.app.state.settings;
    const photo = EW.app.selectedPhoto();
    let selectedKey = (settings.fields[0] || {}).key;

    const listItems = el('div', { class: 'items' });
    const form = el('div', { class: 'split-form' });

    function renderList() {
      listItems.innerHTML = '';
      const builtin = settings.fields.filter(function (f) { return !f.custom; });
      const custom = settings.fields.filter(function (f) { return f.custom; });

      function addGroup(title, list) {
        if (!list.length) return;
        listItems.appendChild(el('div', { class: 'sect', text: title }));
        list.forEach(function (field) {
          const dot = el('span', { class: 'dot' + (field.visible ? ' on' : '') });
          const item = el('div', {
            class: 'row' + (field.key === selectedKey ? ' active' : ''),
            onclick: function () { selectedKey = field.key; renderList(); renderForm(); }
          }, [dot, el('span', { class: 'label', text: field.name })]);
          listItems.appendChild(item);
        });
      }

      addGroup('相机字段', builtin);
      addGroup('自定义字段', custom);
    }

    function current() {
      return settings.fields.find(function (f) { return f.key === selectedKey; }) || null;
    }

    function currentValue() {
      const field = current();
      if (!field || !photo) return '';
      return (photo.meta && photo.meta[field.key]) || '';
    }

    function renderForm() {
      form.innerHTML = '';
      const field = current();
      if (!field) {
        form.appendChild(emptyHint('选择左侧的字段'));
        return;
      }

      form.appendChild(section('字段', [
        row('名称', textField(field.name, function (value) {
          field.name = value;
          renderList();
          EW.app.settingsChanged();
        })),
        row('模板引用', el('div', { class: 'mono', text: '{' + field.key + '}' })),
        switchRow('显示此字段', field.visible, function (value) {
          field.visible = value;
          renderList();
          EW.app.settingsChanged();
        }),
        row('照片中的值', el('div', { class: 'mono', text: currentValue() || '—' }))
      ]));

      const customSection = [
        switchRow('使用自定义值', field.override, function (value) {
          field.override = value;
          renderForm();
          EW.app.settingsChanged();
        })
      ];

      if (field.override) {
        const forceInput = el('input', { type: 'checkbox', class: 'switch' });
        forceInput.checked = !!field.force;
        forceInput.addEventListener('change', function () { field.force = forceInput.checked; EW.app.settingsChanged(); });
        customSection.push(el('label', { class: 'switch-row' }, [el('span', { text: '强制覆盖照片信息' }), forceInput]));

        const area = el('textarea', { rows: 3 });
        area.value = field.value || '';
        area.placeholder = field.key === 'PersonalSign' ? '例如：@你的名字' : '照片缺少该字段时使用此内容';
        area.addEventListener('input', function () { field.value = area.value; EW.app.settingsChanged(); });
        customSection.push(row('字段内容', area));

        customSection.push(el('p', { class: 'form-tip', text: '未强制覆盖时，仅在照片缺少此字段时使用自定义值。个性签名也通过此处设置。' }));

        customSection.push(imagePicker('亮色背景图', 'imageData', field, false));
        customSection.push(imagePicker('暗色背景图', 'darkImageData', field, true));
      }

      form.appendChild(section('自定义内容', customSection));

      const fontSection = [
        switchRow('覆盖模板字体', !!field.style, function (value) {
          field.style = value ? EW.defaultStyle() : null;
          renderForm();
          EW.app.settingsChanged();
        })
      ];

      if (field.style) {
        const style = field.style;
        fontSection.push(row('字体', selectField(EW.allFonts().map(function (f) { return { value: f, label: f }; }), style.font, function (value) {
          style.font = value;
          EW.app.settingsChanged();
        })));
        fontSection.push(row('字号', numberField(style.size, 0.1, 20, 0.1, function (value) {
          style.size = value;
          EW.app.settingsChanged();
        }, '%')));
        fontSection.push(switchRow('粗体', style.bold, function (value) {
          style.bold = value;
          EW.app.settingsChanged();
        }));
        fontSection.push(switchRow('斜体', style.italic, function (value) {
          style.italic = value;
          EW.app.settingsChanged();
        }));
        fontSection.push(row('大小写', selectField([
          { value: 'default', label: '保持原样' },
          { value: 'upper', label: '大写' },
          { value: 'lower', label: '小写' }
        ], style.letterCase, function (value) {
          style.letterCase = value;
          EW.app.settingsChanged();
        })));
        fontSection.push(switchRow('自动文字颜色', !style.color, function (auto) {
          style.color = auto ? '' : '#000000';
          renderForm();
          EW.app.settingsChanged();
        }));
        if (style.color) {
          fontSection.push(row('颜色', swatch(style.color, function (value) {
            style.color = value;
            EW.app.settingsChanged();
          })));
        }
      }

      form.appendChild(section('字段字体', fontSection));
    }

    function imagePicker(label, key, field, dark) {
      const children = [
        el('button', {
          class: 'btn tiny',
          text: label + '…',
          onclick: async function () {
            const file = await pickImageFile();
            if (!file) return;
            try {
              field[key] = await toFieldImage(file);
              await EW.preloadFieldImages(settings);
              renderForm();
              EW.app.settingsChanged();
            } catch (e) {
              ui.toast('无法读取图片：' + e.message, 'error');
            }
          }
        })
      ];
      if (field[key]) {
        children.push(el('div', { class: 'img-preview' }, [
          el('img', { src: field[key], alt: '' }),
          el('button', {
            class: 'btn tiny ghost', text: '移除', onclick: function () {
              field[key] = null;
              renderForm();
              EW.app.settingsChanged();
            }
          })
        ]));
      }
      return el('div', { class: 'form-row' }, [el('label', { text: label }), el('div', { class: 'grow' }, children)]);
    }

    const toolbar = el('div', { class: 'bar-row' }, [
      el('button', {
        class: 'btn tiny', text: '＋', title: '新建自定义字段', onclick: function () {
          const field = {
            key: 'Custom_' + EW.uid(),
            name: '自定义字段',
            visible: true,
            override: true,
            force: true,
            value: '',
            custom: true,
            imageData: null,
            darkImageData: null,
            style: null
          };
          settings.fields.push(field);
          selectedKey = field.key;
          renderList(); renderForm(); EW.app.settingsChanged();
        }
      }),
      el('button', {
        class: 'btn tiny', text: '−', title: '删除自定义字段', onclick: function () {
          const field = current();
          if (!field || !field.custom) return;
          settings.fields.splice(settings.fields.indexOf(field), 1);
          selectedKey = settings.fields.length ? settings.fields[0].key : null;
          renderList(); renderForm(); EW.app.settingsChanged();
        }
      })
    ]);

    renderList();
    renderForm();

    ui.openModal({
      title: '相机与自定义字段',
      body: el('div', { class: 'split' }, [
        el('div', { class: 'split-list' }, [listItems, toolbar]),
        form
      ]),
      foot: [doneButton()]
    });
  };

  /* ---------------- metadata ---------------- */

  ui.openMetadata = function () {
    const photo = EW.app.selectedPhoto();
    if (!photo) {
      ui.toast('请先选择一张照片');
      return;
    }
    const meta = photo.meta || {};
    const keys = Object.keys(meta).sort();
    const list = el('div', { class: 'meta-list' }, keys.map(function (key) {
      return el('div', { class: 'meta-row' }, [
        el('span', { text: key }),
        el('span', { text: meta[key] || '—' })
      ]);
    }));

    ui.openModal({
      title: '照片信息 · ' + photo.name,
      padded: true,
      small: true,
      body: el('div', {}, [list, el('p', { class: 'form-tip', text: '读取自照片 EXIF；缺失的字段会显示为 —。' })]),
      foot: [
        el('button', {
          class: 'btn', text: '复制 JSON', onclick: function () {
            const json = JSON.stringify(meta, null, 2);
            navigator.clipboard.writeText(json).then(function () {
              ui.toast('已复制到剪贴板', 'success');
            }).catch(function () {
              ui.toast('复制失败，请检查浏览器权限', 'error');
            });
          }
        }),
        el('span', { class: 'spacer' }),
        doneButton()
      ]
    });
  };

  ui.openAbout = function () {
    ui.openModal({
      title: '关于',
      padded: true,
      small: true,
      body: el('div', {}, [
        el('p', { class: 'form-tip', text: 'EasyWatermark Web 版：在照片外增加背景、圆角、阴影与相机参数文字，批量生成适合分享的成品图。' }),
        el('p', { class: 'form-tip', text: '功能参考壹印（yiyin）与 EasyWatermark（SwiftUI 版）的实现；品牌 Logo 资源来自壹印，遵循 GPL-3.0。品牌名称与标识的权利属于各自权利人。' }),
        el('p', { class: 'form-tip', text: '全部处理在你的浏览器本地完成，照片不会上传到任何服务器。仅支持 Chrome：导出要把成品图写入本地文件夹，这一能力目前只有 Chrome 提供。' })
      ]),
      foot: [doneButton('好')]
    });
  };

  /* ---------------- toast ---------------- */

  ui.toast = function (message, type) {
    const wrap = document.getElementById('toast-wrap');
    const node = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
    wrap.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .2s';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 220);
    }, type === 'error' ? 4200 : 2400);
  };
})();
