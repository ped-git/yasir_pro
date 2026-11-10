(() => {
  'use strict';

  const query = (selector) => document.querySelector(selector);
  const frame = query('#document');
  let catalog;
  let loaded;
  let workspace = new URLSearchParams(location.search).get('workspace') ?? localStorage.getItem('yasir-studio-workspace') ?? 'interactive';
  let workspaceSwitchConfirmed = false;
  let category = 'underline';
  let savedRange = null;
  let target = null;
  let selectedIds = new Set();
  let css = '';
  let groupLabels = {};
  let history = [];
  let historyIndex = -1;
  let savedState = '';
  let opening = false;
  const quoteColors = ['blue', 'green', 'red', 'black', 'gray', 'lightblue', 'mixed'];
  const underlineTypes = ['uncertain', 'solid', 'dashed', 'dotted', 'double', 'wavy', 'linear-gradient', 'repeating-linear-gradient', 'radial-gradient', 'repeating-radial-gradient'];
  const sidebarWidthKey = 'yasir-studio-sidebar-width';
  const memberListHeightKey = 'yasir-studio-member-list-height';

  const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
  const icons = () => window.lucide?.createIcons();
  const doc = () => frame.contentDocument;
  const message = (text) => { query('#message').textContent = text; };
  const fail = (error) => { query('#error-message').textContent = error.message; query('#error-dialog').showModal(); };
  const safe = (callback) => async (...args) => { try { await callback(...args); } catch (error) { fail(error); } };
  const nodeElement = (node) => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

  function cleanBody() {
    const clone = doc().body.cloneNode(true);
    clone.querySelectorAll('[data-editor-selected]').forEach((element) => element.removeAttribute('data-editor-selected'));
    return clone.innerHTML;
  }

  function state() { return { body: cleanBody(), css, groupLabels: { ...groupLabels } }; }
  function changed() { return loaded && JSON.stringify(state()) !== savedState; }

  function updateState() {
    query('#save-state').textContent = changed() ? 'Unsaved changes' : 'Saved';
    query('#save').disabled = !changed();
    query('#undo').disabled = historyIndex <= 0;
    query('#redo').disabled = historyIndex >= history.length - 1;
  }

  function record() {
    const snapshot = state();
    if (historyIndex >= 0 && JSON.stringify(snapshot) === JSON.stringify(history[historyIndex])) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
    updateState();
    inspect();
  }

  function updateCss() {
    let style = doc().querySelector('#editor-live-css');
    if (!style) { style = doc().createElement('style'); style.id = 'editor-live-css'; doc().head.append(style); }
    style.textContent = css;
  }

  function restore(index) {
    const snapshot = history[index];
    doc().body.innerHTML = snapshot.body;
    css = snapshot.css;
    groupLabels = { ...snapshot.groupLabels };
    historyIndex = index;
    selectedIds.clear(); target = null; savedRange = null;
    updateCss(); inspect(); updateState();
  }

  function addStyle(style) {
    if (!css.includes(`.${style.id}`)) css += `\n${style.css}\n`;
    updateCss();
  }

  function normalizeIds() {
    const used = new Set();
    doc().querySelectorAll('[data-underline-id]').forEach((element) => {
      if (used.has(element.dataset.underlineId)) element.dataset.underlineId = uid('underline');
      used.add(element.dataset.underlineId);
    });
  }

  function annotationTarget(element) {
    return element?.closest('speech,[data-underline-id],[data-reader-section],[data-annotation-effect],.annotation,[class*="text-highlight"],[class*="background-highlight"]') ?? null;
  }

  function pick(element, multiple = false) {
    target = annotationTarget(element);
    if (!multiple) selectedIds.clear();
    if (target?.dataset.underlineId) {
      const id = target.dataset.underlineId;
      if (multiple && selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    }
    inspect();
  }

  function inspect() {
    if (!doc()?.body) return;
    doc().querySelectorAll('[data-editor-selected]').forEach((element) => element.removeAttribute('data-editor-selected'));
    const layer = query('#layer-select');
    layer.replaceChildren(new Option('None', ''));
    let current = target;
    let index = 0;
    while (current && current !== doc().body) {
      if (current.matches('speech,[data-underline-id],[data-reader-section],[data-annotation-effect],[class*="text-highlight"],[class*="background-highlight"]')) {
        const name = current.tagName === 'SPEECH' ? current.hasAttribute('open') ? 'Quote start' : 'Quote end' : current.hasAttribute('data-reader-section') ? 'Vertical section' : current.hasAttribute('data-underline-id') ? 'Underline' : 'Effect';
        layer.add(new Option(`${name}: ${current.textContent.trim().slice(0, 40)}`, String(index++)));
      }
      current = current.parentElement;
    }
    if (target) layer.selectedIndex = 1;
    const selected = [];
    const members = query('#member-list'); members.replaceChildren();
    for (const element of doc().querySelectorAll('[data-underline-id]')) {
      const id = element.dataset.underlineId;
      const label = document.createElement('label'); label.className = 'member';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selectedIds.has(id);
      const text = document.createElement('span'); text.textContent = element.textContent.trim();
      let depth = 0; for (let parent = element.parentElement.closest('[data-underline-id]'); parent; parent = parent.parentElement.closest('[data-underline-id]')) depth++;
      label.style.paddingLeft = `${Math.min(depth, 5) * 10 + 2}px`;
      input.addEventListener('change', () => { if (input.checked) selectedIds.add(id); else selectedIds.delete(id); target = element; inspect(); });
      label.append(input, text); members.append(label);
      if (selectedIds.has(id)) { element.dataset.editorSelected = ''; selected.push(element); }
    }
    if (target?.hasAttribute('data-reader-section')) target.dataset.editorSelected = '';
    if (target?.tagName === 'SPEECH') {
      target.dataset.editorSelected = '';
      query('#quote-color').value = quoteColors.find((color) => target.hasAttribute(color)) ?? 'blue';
    }
    query('#add-quote-pair').disabled = !savedRange || savedRange.collapsed;
    query('#apply-quote-color').disabled = target?.tagName !== 'SPEECH';
    query('#remove-quote-pair').disabled = target?.tagName !== 'SPEECH';
    const common = selected.length ? (selected[0].dataset.underlineGroups ?? '').split(/\s+/).filter((tag) => tag && selected.every((element) => (element.dataset.underlineGroups ?? '').split(/\s+/).includes(tag))) : [];
    query('#group-input').value = common.join(' ');
    query('#group-label').value = common.length === 1 ? groupLabels[common[0]] ?? common[0] : '';
    query('#selection-state').textContent = savedRange && !savedRange.collapsed ? `${savedRange.toString().length} selected characters` : target?.tagName === 'SPEECH' ? `${target.hasAttribute('open') ? 'Opening' : 'Closing'} quotation mark selected` : `${selected.length} checked underlines`;
    renderGroupList();
  }

  function renderGroupList() {
    const list = query('#group-list');
    if (!list) return;
    list.replaceChildren();
    const groups = new Map();
    for (const element of doc().querySelectorAll('[data-underline-id]')) {
      for (const id of new Set((element.dataset.underlineGroups ?? '').split(/\s+/).filter(Boolean))) {
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(element);
      }
    }
    if (!groups.size) {
      const empty = document.createElement('p'); empty.className = 'group-empty'; empty.textContent = 'No saved groups yet. Select underlines and add a group ID.'; list.append(empty); return;
    }
    for (const [id, members] of groups) {
      const row = document.createElement('div'); row.className = 'group-row';
      const select = document.createElement('button'); select.type = 'button'; select.title = 'Select all members of this group';
      select.textContent = `${groupLabels[id] ?? id} · ${members.length}`;
      select.onclick = () => { selectedIds = new Set(members.map((member) => member.dataset.underlineId)); target = members[0] ?? null; query('#group-input').value = id; query('#group-label').value = groupLabels[id] ?? ''; inspect(); message(`Selected ${members.length} group members`); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-group'; remove.title = `Remove group ${id} from all underlines`; remove.setAttribute('aria-label', `Remove group ${groupLabels[id] ?? id}`); remove.innerHTML = '<i data-lucide="unlink"></i>';
      remove.onclick = () => { for (const member of members) member.dataset.underlineGroups = member.dataset.underlineGroups.split(/\s+/).filter((tag) => tag !== id).join(' '); delete groupLabels[id]; record(); message(`Removed group ${id}`); };
      row.append(select, remove); list.append(row);
    }
    icons();
  }

  function captureSelection() {
    const selection = doc().getSelection();
    if (selection.rangeCount && !selection.isCollapsed) savedRange = selection.getRangeAt(0).cloneRange();
  }

  function wrapRange(range, wrapper) {
    const fragment = range.extractContents();
    wrapper.append(fragment); range.insertNode(wrapper);
    normalizeIds();
    return wrapper;
  }

  function makeUnderline(style, group) {
    const element = doc().createElement('span');
    element.className = `annotation underline ${style.id}`;
    element.dataset.underlineId = uid('underline');
    element.dataset.underlineGroups = group;
    return element;
  }

  function underlineBuilder(container) {
    const form = document.createElement('section');
    form.className = 'underline-builder';
    form.innerHTML = `
      <label>Type<select data-setting="type" aria-label="Underline type">
        <option value="uncertain">Uncertain mark</option>
        <option value="solid">Solid</option><option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option><option value="double">Double</option><option value="wavy">Wavy</option>
        <option value="linear-gradient">Linear gradient</option><option value="repeating-linear-gradient">Repeating linear gradient</option>
        <option value="radial-gradient">Radial gradient</option><option value="repeating-radial-gradient">Repeating radial gradient</option>
      </select></label>
      <label>Distance <output data-value="distance">0.7 mm</output><input data-setting="distance" aria-label="Underline distance in millimeters" type="range" min="0" max="9" step="0.1" value="0.7"></label>
      <label>Color<input data-setting="color" aria-label="Underline color" type="color" value="#467046"></label>
      <label data-gradient-setting hidden>Second gradient color<input data-setting="color2" aria-label="Second gradient color" type="color" value="#e7b44a"></label>
      <label data-angle-setting hidden>Gradient angle <output data-value="angle">90°</output><input data-setting="angle" aria-label="Gradient angle" type="range" min="0" max="360" step="5" value="90"></label>
      <label>Thickness <output data-value="thickness">0.5 mm</output><input data-setting="thickness" aria-label="Underline thickness in millimeters" type="range" min="0.1" max="2" step="0.1" value="0.5"></label>
      <fieldset class="underline-sides"><legend>Optional box sides</legend><div class="side-checkboxes">
        <label><input data-side="top" type="checkbox">Top</label><label><input data-side="right" type="checkbox">Right</label>
        <label><input data-side="bottom" type="checkbox">Bottom</label><label><input data-side="left" type="checkbox">Left</label>
      </div><ol class="side-order" aria-label="Selected border side order"></ol></fieldset>
      <div class="underline-preview" aria-live="polite"><span>Preview</span><span class="custom-underline-sample" lang="ar" dir="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ</span></div>
      <button class="apply-underline primary" type="button">Apply underline</button>`;
    container.replaceChildren(form);
    let sideOrder = [];
    const readSettings = () => ({
      type: form.querySelector('[data-setting="type"]').value,
      distance: Number(form.querySelector('[data-setting="distance"]').value),
      color: form.querySelector('[data-setting="color"]').value,
      color2: form.querySelector('[data-setting="color2"]').value,
      angle: Number(form.querySelector('[data-setting="angle"]').value),
      thickness: Number(form.querySelector('[data-setting="thickness"]').value),
    });
    const renderSideOrder = () => {
      const list = form.querySelector('.side-order');
      list.replaceChildren();
      for (const [index, side] of sideOrder.entries()) {
        const row = document.createElement('li');
        const name = document.createElement('span'); name.textContent = side[0].toUpperCase() + side.slice(1);
        const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.setAttribute('aria-label', `Move ${side} border earlier`); up.disabled = index === 0;
        const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.setAttribute('aria-label', `Move ${side} border later`); down.disabled = index === sideOrder.length - 1;
        up.addEventListener('click', () => { [sideOrder[index - 1], sideOrder[index]] = [sideOrder[index], sideOrder[index - 1]]; renderSideOrder(); updatePreview(); });
        down.addEventListener('click', () => { [sideOrder[index + 1], sideOrder[index]] = [sideOrder[index], sideOrder[index + 1]]; renderSideOrder(); updatePreview(); });
        row.append(name, up, down); list.append(row);
      }
    };
    const gradientImage = (settings) => {
      const { type, angle, color, color2 } = settings;
      if (type === 'linear-gradient') return `linear-gradient(${angle}deg, ${color} 0%, ${color2} 100%)`;
      if (type === 'repeating-linear-gradient') return `repeating-linear-gradient(${angle}deg, ${color} 0, ${color} 8px, ${color2} 16px, ${color2} 24px)`;
      if (type === 'radial-gradient') return `radial-gradient(ellipse at center, ${color} 0%, ${color2} 12%, ${color2} 100%)`;
      if (type === 'repeating-radial-gradient') return `repeating-radial-gradient(circle at center, ${color} 0, ${color} 2px, ${color2} 3px, ${color2} 5px)`;
      return 'none';
    };
    const gradientSize = (settings) => settings.type === 'repeating-radial-gradient'
      ? `16px ${settings.thickness}mm`
      : `100% ${settings.thickness}mm`;
    const makeStyle = (settings) => {
      const compact = (value) => String(Math.round(value * 10));
      const isGradient = settings.type.endsWith('gradient');
      const lineStyle = ['solid', 'dashed', 'dotted', 'double', 'wavy'].includes(settings.type) ? settings.type : 'solid';
      const id = `edit-style-custom-v4-${settings.type}-${settings.color.slice(1)}-${settings.color2.slice(1)}-${settings.angle}-${compact(settings.distance)}-${compact(settings.thickness)}-${sideOrder.join('-') || 'no-sides'}`;
      const underlineCss = settings.type === 'uncertain'
        ? `  text-decoration: none !important;\n  border-left: 1px dotted rgb(100, 100, 100) !important;\n  border-right: 1px dotted rgb(100, 100, 100) !important;\n  padding: 0px 0.264583mm !important;`
        : isGradient
        ? `  text-decoration: none;\n  background-image: ${gradientImage(settings)};\n  background-position: 0 100%;\n  background-repeat: repeat-x;\n  background-size: ${gradientSize(settings)};\n  padding-bottom: ${settings.distance + settings.thickness}mm !important;`
        : `  text-decoration-line: underline;\n  text-decoration-style: ${lineStyle};\n  text-decoration-color: ${settings.color};\n  text-decoration-thickness: ${settings.thickness}mm;\n  text-underline-offset: ${settings.distance}mm;`;
      const sidesCss = sideOrder.map((side) => `  border-${side}: ${settings.thickness}mm ${lineStyle} ${settings.color} !important;`).join('\n');
      return {
        id,
        kind: 'underline',
        label: `${settings.type}, ${settings.distance.toFixed(1)} mm, ${settings.color}, ${settings.thickness.toFixed(1)} mm${sideOrder.length ? `, ${sideOrder.join(' → ')}` : ''}`,
        sourceClasses: [id],
        css: `.${id}:not(#edit-reserved) {\n  border: 0 !important;\n  padding: 0 !important;\n${underlineCss}\n${sidesCss}\n}`,
      };
    };
    const updatePreview = () => {
      const settings = readSettings();
      const isGradient = settings.type.endsWith('gradient');
      const isUncertain = settings.type === 'uncertain';
      form.querySelectorAll('[data-gradient-setting]').forEach((element) => { element.hidden = !isGradient || isUncertain; });
      form.querySelectorAll('[data-angle-setting]').forEach((element) => { element.hidden = !settings.type.includes('linear') || isUncertain; });
      for (const name of ['distance', 'color', 'thickness']) form.querySelector(`[data-setting="${name}"]`).closest('label').hidden = isUncertain;
      form.querySelector('.underline-sides').hidden = isUncertain;
      form.querySelector('[data-value="distance"]').textContent = `${settings.distance.toFixed(1)} mm`;
      form.querySelector('[data-value="thickness"]').textContent = `${settings.thickness.toFixed(1)} mm`;
      form.querySelector('[data-value="angle"]').textContent = `${settings.angle}°`;
      const sample = form.querySelector('.custom-underline-sample');
      const style = makeStyle(settings);
      sample.className = `custom-underline-sample ${style.id}`;
      let previewStyle = document.querySelector('#custom-underline-preview-css');
      if (!previewStyle) { previewStyle = document.createElement('style'); previewStyle.id = 'custom-underline-preview-css'; document.head.append(previewStyle); }
      previewStyle.textContent = style.css;
      if (savedRange && !savedRange.collapsed) {
        const selectedText = savedRange.toString();
        if (selectedText) {
          sample.textContent = selectedText;
          const sourceStyle = getComputedStyle(nodeElement(savedRange.startContainer));
          for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'direction', 'writingMode']) {
            sample.style[property] = sourceStyle[property];
          }
        }
      }
    };
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);
    form.querySelectorAll('[data-side]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      const { side } = checkbox.dataset;
      sideOrder = checkbox.checked ? [...sideOrder, side] : sideOrder.filter((entry) => entry !== side);
      renderSideOrder();
      updatePreview();
    }));
    form.querySelector('.apply-underline').addEventListener('click', safe(() => {
      const settings = readSettings();
      if (!underlineTypes.includes(settings.type) || !/^#[\da-f]{6}$/i.test(settings.color) || !/^#[\da-f]{6}$/i.test(settings.color2)
        || !Number.isFinite(settings.distance) || !Number.isFinite(settings.thickness) || !Number.isFinite(settings.angle)) {
        throw new Error('Choose valid underline settings.');
      }
      applyStyle(makeStyle(settings));
    }));
    updatePreview();
  }

  function applyInline(style) {
    addStyle(style);
    const range = savedRange?.cloneRange();
    if (!range || range.collapsed) {
      if (!target) throw new Error('Select text or an existing annotation first.');
      if (style.kind === 'underline' && target.hasAttribute('data-underline-id')) {
        target.className = [...target.classList].filter((name) => !name.startsWith('ul-') && !name.startsWith('edit-style-custom-') && !catalog.styles.some((entry) => entry.kind === 'underline' && entry.id === name)).join(' ');
        target.classList.add('annotation', 'underline', style.id);
      } else {
        target.classList.add(style.id); target.dataset.annotationEffect = style.kind;
      }
      return;
    }
    const group = uid('manual');
    let wrapper;
    const fragment = range.cloneContents();
    if (fragment.querySelector('p,div,section')) {
      const walker = doc().createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
      for (const node of nodes.reverse()) {
        const part = doc().createRange(); part.selectNodeContents(node);
        if (node === range.startContainer) part.setStart(node, range.startOffset);
        if (node === range.endContainer) part.setEnd(node, range.endOffset);
        if (!part.toString().trim()) continue;
        wrapper = style.kind === 'underline' ? makeUnderline(style, group) : doc().createElement('span');
        if (style.kind !== 'underline') { wrapper.className = style.id; wrapper.dataset.annotationEffect = style.kind; }
        wrapRange(part, wrapper);
      }
    } else {
      wrapper = style.kind === 'underline' ? makeUnderline(style, group) : doc().createElement('span');
      if (style.kind !== 'underline') { wrapper.className = style.id; wrapper.dataset.annotationEffect = style.kind; }
      wrapRange(range, wrapper);
    }
    if (!wrapper) throw new Error('The selection contains no annotatable text.');
    target = wrapper; selectedIds = new Set(wrapper.dataset.underlineId ? [wrapper.dataset.underlineId] : []);
    savedRange = null; doc().getSelection().removeAllRanges();
  }

  function applyVertical(style) {
    if (!savedRange || savedRange.collapsed) throw new Error('Select the section text first.');
    addStyle(style);
    const range = savedRange.cloneRange();
    const common = nodeElement(range.commonAncestorContainer);
    const insideParagraph = common.closest('p') || common !== doc().body && !range.cloneContents().querySelector('p,div');
    if (!insideParagraph && common !== nodeElement(range.startContainer) && common !== nodeElement(range.endContainer)) {
      const children = [...common.childNodes].filter((node) => range.intersectsNode(node));
      if (children.length) { range.setStartBefore(children[0]); range.setEndAfter(children.at(-1)); }
    }
    const section = doc().createElement(insideParagraph ? 'span' : 'div');
    const id = uid('section');
    section.className = `verse-group ${style.id}-section`;
    section.dataset.readerSection = id;
    const line = doc().createElement('span');
    line.className = `${style.id}-line`;
    line.dataset.readerLine = uid('line'); line.dataset.readerOwner = id;
    line.setAttribute('role', 'button'); line.tabIndex = 0; line.setAttribute('aria-expanded', 'true'); line.setAttribute('aria-label', 'Collapse or expand this section');
    const content = range.extractContents();
    const ornaments = (style.caps ?? []).map((cap, index) => {
      const marker = doc().createElement('span');
      marker.className = `${style.id}-cap-${index}`;
      marker.dataset.readerOrnament = cap.bottom ? 'bottom' : 'top';
      marker.textContent = cap.text;
      return marker;
    });
    section.append(line, ...ornaments, content); range.insertNode(section);
    const extra = `.${style.id}-section {display:block;position:relative;padding-inline:10mm;}`;
    if (!css.includes(extra)) css += `\n${extra}\n`;
    updateCss(); normalizeIds(); target = section; savedRange = null; selectedIds.clear(); doc().getSelection().removeAllRanges();
  }

  function ensureQuoteCss() {
    const colors = {
      blue: 'rgb(70, 70, 220)', green: 'rgb(70, 175, 70)', red: 'rgb(205, 100, 100)',
      black: 'black', gray: 'rgb(150, 150, 150)', lightblue: 'rgb(150, 150, 255)', mixed: 'rgb(140, 140, 85)',
    };
    const rules = [
      '.edit-quote-open::before { content: "«"; position: relative; top: 1.5mm; font-size: 8mm; }',
      '.edit-quote-close::before { content: "»"; position: relative; top: 1.5mm; font-size: 8mm; }',
      ...Object.entries(colors).map(([name, color]) => `.edit-quote-color-${name}::before { color: ${color}; }`),
    ];
    for (const rule of rules) {
      const selector = rule.slice(0, rule.indexOf(' {'));
      if (!css.includes(selector)) css += `\n${rule}`;
    }
    for (const position of ['open', 'close']) {
      const selector = `.edit-quote-${position}::before`;
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hasCorrectSize = new RegExp(`${escapedSelector}\\s*\\{[^}]*font-size\\s*:\\s*8mm\\s*;`, 'i').test(css);
      if (!hasCorrectSize) css += `\n${selector} { font-size: 8mm; }`;
    }
    updateCss();
  }

  function quotePair(marker) {
    const id = marker.dataset.quotePair;
    if (id) {
      const pair = [...doc().querySelectorAll('speech[data-quote-pair]')].filter((element) => element.dataset.quotePair === id);
      if (pair.length === 2) return pair;
    }
    const stack = [];
    const pairs = new Map();
    for (const current of doc().querySelectorAll('speech[open],speech[close]')) {
      if (current.hasAttribute('open')) stack.push(current);
      else if (current.hasAttribute('close')) {
        const opening = stack.pop();
        if (opening) { pairs.set(opening, current); pairs.set(current, opening); }
      }
    }
    const mate = pairs.get(marker);
    return mate ? [marker, mate] : [marker];
  }

  function makeQuoteMarker(position, color, pairId) {
    const marker = doc().createElement('speech');
    marker.setAttribute(position, '');
    marker.setAttribute(color, '');
    marker.setAttribute('data-quote-pair', pairId);
    marker.classList.add('edit-quote-marker', `edit-quote-${position}`, `edit-quote-color-${color}`);
    return marker;
  }

  function liftQuoteMarkerOutsideUnderlines(marker) {
    let underline = marker.parentElement?.closest('[data-underline-id]');
    const affected = new Set();
    while (underline) {
      affected.add(underline);
      let branch = marker;
      while (branch.parentElement !== underline) {
        const parent = branch.parentElement;
        if (!parent) return;
        affected.add(parent);
        const right = parent.cloneNode(false);
        while (branch.nextSibling) right.append(branch.nextSibling);
        if ([...right.childNodes].some((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.length)) {
          affected.add(right);
          parent.after(right);
        }
        branch = parent;
      }

      const right = underline.cloneNode(false);
      while (marker.nextSibling) right.append(marker.nextSibling);
      underline.after(marker);
      if ([...right.childNodes].some((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.length)) {
        affected.add(right);
        marker.after(right);
      }
      underline = marker.parentElement?.closest('[data-underline-id]');
    }
    const cleanEmptyNodes = (element) => {
      for (const child of [...element.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE && !child.textContent) child.remove();
        else if (child.nodeType === Node.ELEMENT_NODE && affected.has(child)) {
          cleanEmptyNodes(child);
          if (!child.hasChildNodes()) child.remove();
        }
      }
    };
    for (const element of affected) {
      cleanEmptyNodes(element);
      if (!element.hasChildNodes()) element.remove();
    }
    normalizeIds();
  }

  function addQuotationPair() {
    const range = savedRange?.cloneRange();
    if (!range || range.collapsed || !range.toString().trim()) throw new Error('Select the quoted words first.');
    const color = query('#quote-color').value;
    if (!quoteColors.includes(color)) throw new Error('Choose a supported quotation color.');
    ensureQuoteCss();
    const pairId = uid('quote');
    const closing = makeQuoteMarker('close', color, pairId);
    const opening = makeQuoteMarker('open', color, pairId);
    const end = range.cloneRange(); end.collapse(false); end.insertNode(closing); liftQuoteMarkerOutsideUnderlines(closing);
    const start = range.cloneRange(); start.collapse(true); start.insertNode(opening); liftQuoteMarkerOutsideUnderlines(opening);
    target = opening; selectedIds.clear(); savedRange = null;
    doc().getSelection().removeAllRanges();
    record(); message(`Added ${color} quotation pair`);
  }

  function applyQuotationColor() {
    if (target?.tagName !== 'SPEECH') throw new Error('Select an opening or closing quotation mark first.');
    const color = query('#quote-color').value;
    if (!quoteColors.includes(color)) throw new Error('Choose a supported quotation color.');
    ensureQuoteCss();
    for (const marker of quotePair(target)) {
      for (const name of quoteColors) marker.removeAttribute(name);
      marker.setAttribute(color, '');
      marker.classList.remove(...quoteColors.map((name) => `edit-quote-color-${name}`));
      marker.classList.add('edit-quote-marker', `edit-quote-${marker.hasAttribute('open') ? 'open' : 'close'}`, `edit-quote-color-${color}`);
    }
    record(); message(`Quotation pair changed to ${color}`);
  }

  function groupIds() {
    const tags = [...new Set(query('#group-input').value.trim().split(/\s+/).filter(Boolean))];
    if (!tags.every((tag) => /^[a-zA-Z0-9_-]+$/.test(tag))) throw new Error('Group IDs use letters, numbers, hyphens, and underscores.');
    return tags;
  }

  function updateGroupMembership(mode) {
    if (!selectedIds.size) throw new Error('Check at least one underline.');
    const tags = groupIds();
    if (mode !== 'ungroup' && !tags.length) throw new Error('Enter or select at least one group ID.');
    const all = new Map([...doc().querySelectorAll('[data-underline-id]')].map((element) => [element.dataset.underlineId, element]));
    for (const id of selectedIds) {
      const element = all.get(id);
      if (!element) continue;
      const current = (element.dataset.underlineGroups ?? '').split(/\s+/).filter(Boolean);
      const next = mode === 'replace' ? tags : mode === 'add' ? [...new Set([...current, ...tags])] : mode === 'remove' ? current.filter((tag) => !tags.includes(tag)) : [];
      element.dataset.underlineGroups = next.join(' ');
    }
    if ((mode === 'replace' || mode === 'add') && tags.length === 1 && query('#group-label').value.trim()) groupLabels[tags[0]] = query('#group-label').value.trim();
    record();
    message(mode === 'replace' ? 'Group memberships replaced' : mode === 'add' ? 'Added underlines to groups' : mode === 'remove' ? 'Removed underlines from groups' : 'Selected underlines ungrouped');
  }

  function applyStyle(style) {
    if (style.kind === 'vertical') applyVertical(style); else applyInline(style);
    query('#context-menu').hidden = true; record(); message(`Applied ${style.kind}`);
  }

  function unwrap(element) { element.replaceWith(...element.childNodes); }

  function removeAnnotation() {
    if (!target) throw new Error('Select an annotation layer first.');
    if (target.tagName === 'SPEECH') {
      for (const marker of quotePair(target)) marker.remove();
      message('Quotation pair removed');
    } else if (target.hasAttribute('data-reader-section')) {
      for (const child of [...target.children]) if (child.hasAttribute('data-reader-line') || child.hasAttribute('data-reader-ornament') || [...child.classList].some((name) => name.startsWith('connection-cap--'))) child.remove();
      unwrap(target);
    } else if (target.hasAttribute('data-underline-id')) {
      target.removeAttribute('data-underline-id'); target.removeAttribute('data-underline-groups');
      for (const name of [...target.classList]) if (name === 'underline' || name === 'annotation' || name.startsWith('ul-') || name.startsWith('edit-style-custom-') || catalog.styles.some((entry) => entry.id === name && entry.kind === 'underline')) target.classList.remove(name);
      target.removeAttribute('data-editor-selected');
      if (!target.className.trim()) target.removeAttribute('class');
      if (!target.attributes.length) unwrap(target);
    } else {
      for (const name of [...target.classList]) if (catalog.styles.some((entry) => entry.id === name || entry.kind !== 'underline' && entry.kind !== 'vertical' && entry.sourceClasses.includes(name))) target.classList.remove(name);
      target.removeAttribute('data-annotation-effect'); target.removeAttribute('data-editor-selected');
      if (!target.className.trim()) target.removeAttribute('class');
      if (!target.attributes.length) unwrap(target);
    }
    target = null; selectedIds.clear(); savedRange = null; record(); message('Annotation removed');
  }

  function styleButton(style) {
    const button = document.createElement('button'); button.className = 'style-option'; button.dataset.styleId = style.id; button.title = `${style.label}\n${style.sourceClasses.join(' ')}`;
    const frame = document.createElement('span'); frame.className = 'sample-frame';
    const sample = document.createElement('span'); sample.className = `palette-sample ${style.id}`;
    sample.textContent = '\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0651\u064e\u0647\u0650';
    if (style.kind === 'vertical') {
      sample.className = 'vertical-sample'; sample.textContent = ''; sample.style.cssText = style.declarations; sample.style.position = 'relative'; sample.style.right = 'auto'; sample.style.top = 'auto'; sample.style.transform = 'none'; sample.style.height = '25px'; sample.style.width = '1px';
      for (const cap of style.caps ?? []) {
        const marker = document.createElement('span'); marker.textContent = cap.text; marker.style.cssText = cap.declarations;
        Object.assign(marker.style, { position: 'absolute', right: 'auto', left: '-2px', top: cap.bottom ? 'auto' : '0', bottom: cap.bottom ? '0' : 'auto' }); sample.append(marker);
      }
    }
    frame.append(sample);
    const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.backgroundColor = style.color;
    const label = document.createElement('span'); label.className = 'style-label'; label.textContent = style.label;
    button.append(frame, swatch, label); button.addEventListener('click', safe(() => applyStyle(style)));
    return button;
  }

  function renderStyles(container = query('#style-list'), filter = query('#style-filter').value) {
    container.replaceChildren();
    if (category === 'underline') {
      underlineBuilder(container);
      query('#style-count').textContent = 'Custom';
      return;
    }
    const styles = catalog.styles.filter((style) => style.kind === category && `${style.label} ${style.sourceClasses.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
    for (const style of styles) container.append(styleButton(style));
    query('#style-count').textContent = `${styles.length} styles`;
  }

  function setCategory(kind) {
    category = kind;
    document.querySelectorAll('[data-kind]').forEach((entry) => entry.setAttribute('aria-selected', String(entry.dataset.kind === kind)));
    const custom = kind === 'underline';
    query('#style-filter').closest('.search').hidden = custom;
    query('#style-help').textContent = custom
      ? 'Choose the underline type, distance, color, and thickness. Preview updates as you adjust the settings.'
      : 'Select text in the page, then choose a style. Select inside an underline or section to nest another layer.';
    renderStyles();
  }

  function contextMenu(event) {
    event.preventDefault(); captureSelection();
    if (!selectedIds.size || !event.ctrlKey && !event.metaKey) pick(nodeElement(event.target));
    const menu = query('#context-menu'); menu.replaceChildren(); menu.hidden = false;
    const bounds = frame.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(innerWidth - 296, bounds.left + event.clientX))}px`;
    menu.style.top = `${Math.max(4, Math.min(innerHeight - 360, bounds.top + event.clientY))}px`;
    const items = [['underline', 'underline', 'Underlines'], ['vertical', 'panel-right-close', 'Vertical section'], ['highlight', 'highlighter', 'Highlights'], ['effect', 'type', 'Text effects']];
    for (const [kind, icon, label] of items) {
      const button = document.createElement('button'); button.innerHTML = `<i data-lucide="${icon}"></i>${label}`;
      button.addEventListener('click', () => {
        setCategory(kind); menu.replaceChildren();
        const back = document.createElement('button'); back.className = 'menu-back'; back.innerHTML = '<i data-lucide="arrow-left"></i>Back'; back.onclick = () => contextMenu(event);
        const list = document.createElement('div');
        menu.append(back);
        if (kind !== 'underline') {
          const filter = document.createElement('input'); filter.type = 'search'; filter.placeholder = 'Filter styles';
          filter.addEventListener('input', () => renderStyles(list, filter.value));
          menu.append(filter);
        }
        menu.append(list); renderStyles(list, ''); icons();
      });
      menu.append(button);
    }
    const remove = document.createElement('button'); remove.innerHTML = '<i data-lucide="eraser"></i>Remove selected layer'; remove.addEventListener('click', safe(() => { removeAnnotation(); menu.hidden = true; })); menu.append(remove);
    const group = document.createElement('button'); group.innerHTML = '<i data-lucide="link"></i>Edit groups'; group.onclick = () => { menu.hidden = true; query('#group-input').focus(); }; menu.append(group); icons();
  }

  function bindDocument() {
    const style = doc().createElement('style'); style.textContent = '[data-editor-selected] {outline:none;background-color:rgba(37,115,81,.12);border-radius:2px;}'; doc().head.append(style);
    doc().addEventListener('contextmenu', contextMenu);
    doc().addEventListener('mouseup', (event) => { if (event.button !== 0) return; captureSelection(); pick(nodeElement(event.target), event.ctrlKey || event.metaKey); });
    doc().addEventListener('click', (event) => { if (nodeElement(event.target).closest('a')) event.preventDefault(); query('#context-menu').hidden = true; });
    doc().addEventListener('keydown', hotkeys);
    updateCss();
  }

  async function openPage(page, discard = false) {
    if (opening) return;
    if (!discard && changed() && !confirm('Discard unsaved changes?')) { query('#page-select').value = loaded.page; return; }
    opening = true;
    try {
      const response = await fetch(`/api/document?workspace=${encodeURIComponent(workspace)}&page=${encodeURIComponent(page)}`); loaded = await response.json(); if (!response.ok) throw new Error(loaded.error);
      css = loaded.css; groupLabels = Object.fromEntries(loaded.data.groups.map((group) => [group.id, group.label]));
      target = null; savedRange = null; selectedIds.clear();
      await new Promise((resolve) => { frame.onload = resolve; frame.src = `/document?workspace=${encodeURIComponent(workspace)}&page=${encodeURIComponent(page)}`; });
      await doc().fonts.ready; bindDocument();
      history = []; historyIndex = -1; savedState = JSON.stringify(state()); record();
      query('#document-path').textContent = `${workspace}/${page}`; query('#page-select').value = page; message('');
    } finally { opening = false; }
  }

  async function save() {
    const response = await fetch(`/api/save?workspace=${encodeURIComponent(workspace)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Token': catalog.token }, body: JSON.stringify({ page: loaded.page, hash: loaded.hash, cssHash: loaded.cssHash, ...state() }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    loaded = result; savedState = JSON.stringify(state()); updateState(); message(`Saved to ${workspace} at ${result.savedAt.slice(11, 19)}; backup retained`);
  }

  function hotkeys(event) {
    if (event.key === 'Escape') query('#context-menu').hidden = true;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === 's') { event.preventDefault(); safe(save)(); }
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); const next = historyIndex + (event.shiftKey ? 1 : -1); if (history[next]) restore(next); }
  }

  query('#save').onclick = safe(save);
  query('#undo').onclick = () => { if (history[historyIndex - 1]) restore(historyIndex - 1); };
  query('#redo').onclick = () => { if (history[historyIndex + 1]) restore(historyIndex + 1); };
  query('#preview').onclick = () => window.open(`/${encodeURIComponent(workspace)}/${loaded.page.split('/').map(encodeURIComponent).join('/')}`, '_blank', 'noopener');
  query('#remove').onclick = safe(removeAnnotation);
  query('#add-quote-pair').onclick = safe(addQuotationPair);
  query('#apply-quote-color').onclick = safe(applyQuotationColor);
  query('#remove-quote-pair').onclick = safe(removeAnnotation);
  query('#close-error').onclick = () => query('#error-dialog').close();
  query('#open-guide').onclick = () => query('#guide-dialog').showModal();
  const closeGuide = () => {
    if (query('#guide-dont-show').checked) localStorage.setItem('yasir-studio-guide-v1', 'dismissed');
    query('#guide-dialog').close();
  };
  query('#guide-close').onclick = closeGuide;
  query('#guide-start').onclick = closeGuide;
  query('#style-filter').oninput = () => renderStyles();
  query('#page-select').onchange = safe((event) => openPage(event.target.value));
  query('#workspace-select').onchange = () => {
    const next = query('#workspace-select').value;
    if (next === workspace) return;
    if (changed() && !confirm('Discard unsaved changes and switch readers?')) { query('#workspace-select').value = workspace; return; }
    workspaceSwitchConfirmed = true;
    localStorage.setItem('yasir-studio-workspace', next);
    const url = new URL(location.href);
    url.searchParams.set('workspace', next);
    location.assign(url.href);
  };
  query('#clear-selection').onclick = () => { selectedIds.clear(); target = null; inspect(); };
  query('#replace-groups').onclick = safe(() => updateGroupMembership('replace'));
  query('#add-to-groups').onclick = safe(() => updateGroupMembership('add'));
  query('#remove-from-groups').onclick = safe(() => updateGroupMembership('remove'));
  query('#ungroup-selected').onclick = safe(() => updateGroupMembership('ungroup'));
  query('#refresh-groups').onclick = renderGroupList;
  query('#layer-select').onchange = () => {
    const list = []; for (let element = target; element && element !== doc().body; element = element.parentElement) if (element.matches('speech,[data-underline-id],[data-reader-section],[data-annotation-effect],[class*="text-highlight"],[class*="background-highlight"]')) list.push(element);
    const selected = list[Number(query('#layer-select').value)]; if (selected) { target = selected; selectedIds = new Set(selected.dataset.underlineId ? [selected.dataset.underlineId] : []); inspect(); }
  };
  document.querySelectorAll('[data-kind]').forEach((button) => button.onclick = () => setCategory(button.dataset.kind));
  const resizer = query('#sidebar-resizer');
  const setSidebarWidth = (requested) => {
    const min = innerWidth <= 700 ? 205 : 240;
    const max = Math.max(min, Math.min(600, document.querySelector('.workspace').clientWidth - 320));
    const width = Math.max(min, Math.min(max, requested));
    document.querySelector('.workspace').style.setProperty('--sidebar-width', `${width}px`);
    resizer.setAttribute('aria-valuemin', String(min));
    resizer.setAttribute('aria-valuemax', String(max));
    resizer.setAttribute('aria-valuenow', String(Math.round(width)));
    localStorage.setItem(sidebarWidthKey, String(Math.round(width)));
  };
  const savedSidebarWidth = Number(localStorage.getItem(sidebarWidthKey));
  setSidebarWidth(Number.isFinite(savedSidebarWidth) && savedSidebarWidth > 0 ? savedSidebarWidth : innerWidth <= 700 ? 205 : 340);
  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    const move = (pointerEvent) => setSidebarWidth(pointerEvent.clientX - document.querySelector('.workspace').getBoundingClientRect().left);
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', () => resizer.removeEventListener('pointermove', move), { once: true });
    resizer.addEventListener('pointercancel', () => resizer.removeEventListener('pointermove', move), { once: true });
  });
  resizer.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current = Number(resizer.getAttribute('aria-valuenow')) || 340;
    setSidebarWidth(current + (event.key === 'ArrowRight' ? 20 : -20));
  });
  window.addEventListener('resize', () => {
    const current = Number.parseFloat(getComputedStyle(document.querySelector('.workspace')).getPropertyValue('--sidebar-width'));
    if (Number.isFinite(current)) setSidebarWidth(current);
    const listHeight = Number.parseFloat(getComputedStyle(document.querySelector('.members')).getPropertyValue('--member-list-height'));
    if (Number.isFinite(listHeight)) setMemberListHeight(listHeight);
  });
  const memberResizer = query('#member-list-resizer');
  const setMemberListHeight = (requested) => {
    const min = 140;
    const max = Math.max(min, Math.floor(innerHeight * 0.7));
    const height = Math.max(min, Math.min(max, requested));
    document.querySelector('.members').style.setProperty('--member-list-height', `${height}px`);
    memberResizer.setAttribute('aria-valuemin', String(min));
    memberResizer.setAttribute('aria-valuemax', String(max));
    memberResizer.setAttribute('aria-valuenow', String(Math.round(height)));
    localStorage.setItem(memberListHeightKey, String(Math.round(height)));
  };
  const savedMemberListHeight = Number(localStorage.getItem(memberListHeightKey));
  setMemberListHeight(Number.isFinite(savedMemberListHeight) && savedMemberListHeight > 0 ? savedMemberListHeight : innerWidth <= 700 ? 220 : 280);
  memberResizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    memberResizer.setPointerCapture(event.pointerId);
    const move = (pointerEvent) => setMemberListHeight(pointerEvent.clientY - query('#member-list').getBoundingClientRect().top);
    memberResizer.addEventListener('pointermove', move);
    memberResizer.addEventListener('pointerup', () => memberResizer.removeEventListener('pointermove', move), { once: true });
    memberResizer.addEventListener('pointercancel', () => memberResizer.removeEventListener('pointermove', move), { once: true });
  });
  memberResizer.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const current = Number(memberResizer.getAttribute('aria-valuenow')) || 280;
    setMemberListHeight(current + (event.key === 'ArrowDown' ? 20 : -20));
  });
  document.addEventListener('keydown', hotkeys);
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest('#context-menu')) query('#context-menu').hidden = true; });
  window.addEventListener('beforeunload', (event) => { if (changed() && !workspaceSwitchConfirmed) { event.preventDefault(); event.returnValue = ''; } });
  safe(async () => {
    const response = await fetch(`/api/catalog?workspace=${encodeURIComponent(workspace)}`);
    catalog = await response.json();
    if (!response.ok) throw new Error(catalog.error);
    workspace = catalog.workspace ?? workspace;
    query('#workspace-select').replaceChildren(...catalog.workspaces.map((item) => new Option(item.label, item.id)));
    query('#workspace-select').value = workspace;
    const paletteCss = document.createElement('style'); paletteCss.textContent = catalog.styles.filter((style) => style.kind !== 'vertical').map((style) => style.css).join('\n'); document.head.append(paletteCss);
    for (const page of catalog.pages) query('#page-select').add(new Option(page.page.replace('Surah/', '').replace('_html.html', '').replace('.html', ''), page.page));
    icons(); setCategory(category);
    await openPage(catalog.pages.find((entry) => entry.page.includes('001_Fatiha'))?.page ?? catalog.pages[0].page, true);
    if (localStorage.getItem('yasir-studio-guide-v1') !== 'dismissed') query('#guide-dialog').showModal();
  })();
})();