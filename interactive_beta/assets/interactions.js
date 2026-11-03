(() => {
  'use strict';

  const underlines = [...document.querySelectorAll('[data-underline-id]')];
  const originalStyleAttributes = new WeakMap(underlines.map((element) => [element, element.getAttribute('style')]));
  const modifiedDecoration = new WeakSet();
  const lines = [...document.querySelectorAll('[data-reader-line]')];
  const savedGroupData = document.getElementById('reader-group-data');
  if (!savedGroupData) throw new Error('Missing precomputed reader-group-data; regenerate the saved annotations before publishing this page.');
  const savedIndex = JSON.parse(savedGroupData.textContent);
  if (savedIndex.version !== 1 || !savedIndex.groups || typeof savedIndex.groups !== 'object' || Array.isArray(savedIndex.groups)) throw new Error('Invalid precomputed underline-group index.');
  const groups = savedIndex.groups;
  const underlinesById = new Map(underlines.map((element) => [element.dataset.underlineId, element]));
  const sections = new Map();
  let active = null;
  let activeLine = null;
  let lineRegions = null;
  let pointerFrame = null;
  let emphasized = [];
  let underlineOverlay = null;
  let underlinesEnabled = true;

  function drawUnderline(element) {
    const computed = getComputedStyle(element);
    const borderWidth = parseFloat(computed.borderBottomWidth) || 1;
    if (computed.textDecorationLine.includes('underline')) {
      element.style.setProperty('text-decoration-thickness', `${Math.max(3, (parseFloat(computed.textDecorationThickness) || 1) * 2)}px`);
      modifiedDecoration.add(element);
      return;
    }
    for (const bounds of element.getClientRects()) {
      const stroke = document.createElement('span');
      Object.assign(stroke.style, {
        position: 'fixed', boxSizing: 'border-box', left: `${bounds.left}px`,
        top: `${bounds.bottom - borderWidth}px`,
        width: `${bounds.width}px`, height: `${borderWidth}px`, borderBottomStyle: computed.borderBottomStyle,
        borderBottomColor: computed.borderBottomColor, borderBottomWidth: `${borderWidth}px`,
        borderImage: computed.borderImage,
        filter: `drop-shadow(0 0 1px ${computed.borderBottomColor}) drop-shadow(0 0 1px ${computed.borderBottomColor})`,
      });
      if (computed.backgroundImage !== 'none') {
        Object.assign(stroke.style, {
          top: `${bounds.top}px`, height: `${bounds.height}px`, border: '0',
          backgroundImage: computed.backgroundImage, backgroundSize: computed.backgroundSize,
          backgroundPosition: computed.backgroundPosition, backgroundRepeat: computed.backgroundRepeat,
          backgroundOrigin: computed.backgroundOrigin, backgroundClip: computed.backgroundClip,
          backgroundAttachment: computed.backgroundAttachment, filter: 'drop-shadow(0 1px 0 #777)',
        });
      }
      stroke.dataset.readerEmphasisPattern = computed.backgroundImage !== 'none' ? 'zigzag' : computed.borderBottomStyle;
      underlineOverlay.append(stroke);
    }
  }

  for (const line of lines) {
    const owner = document.querySelector(`[data-reader-section="${line.dataset.readerOwner}"]`);
    if (!owner) continue;
    if (!sections.has(owner.dataset.readerSection)) {
      const words = owner.textContent.trim().split(/\s+/).filter(Boolean);
      const firstCount = Math.min(8, Math.ceil(words.length / 2));
      const lastCount = Math.min(8, words.length - firstCount);
      sections.set(owner.dataset.readerSection, {
        element: owner,
        lines: [],
        originalNodes: null,
        summary: null,
        ornamentStyle: null,
        first: words.slice(0, firstCount).join(' '),
        last: lastCount ? words.slice(-lastCount).join(' ') : '',
      });
    }
    sections.get(owner.dataset.readerSection).lines.push(line);
  }

  function clearHighlight() {
    underlineOverlay?.remove();
    underlineOverlay = null;
    for (const element of emphasized) {
      element.classList.remove('reader-related', 'reader-decoration-related');
      if (modifiedDecoration.has(element)) {
        const originalStyle = originalStyleAttributes.get(element);
        if (originalStyle === null || originalStyle === '') element.removeAttribute('style');
        else element.setAttribute('style', originalStyle);
        modifiedDecoration.delete(element);
      }
    }
    emphasized = [];
    active = null;
  }

  function excerptContent(section) {
    const textNodes = [];
    const walker = document.createTreeWalker(section.element, NodeFilter.SHOW_TEXT);
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('[data-reader-line],[data-reader-ornament],[class*="connection-cap--"]')) continue;
      textNodes.push({ node, start: text.length, end: text.length + node.textContent.length });
      text += node.textContent;
    }
    const words = [...text.matchAll(/\S+/gu)];
    const firstCount = Math.min(8, Math.ceil(words.length / 2));
    const lastCount = Math.min(8, words.length - firstCount);
    const fragment = (start, end) => {
      const result = document.createDocumentFragment();
      for (const record of textNodes) {
        if (record.end <= start || record.start >= end) continue;
        const span = document.createElement('span');
        const style = getComputedStyle(record.node.parentElement);
        for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'vertical-align', 'color', 'text-transform']) span.style.setProperty(property, style.getPropertyValue(property));
        span.textContent = record.node.textContent.slice(Math.max(0, start - record.start), Math.min(record.end, end) - record.start);
        result.append(span);
      }
      return result;
    };
    return {
      first: words.length ? fragment(words[0].index, words[firstCount - 1].index + words[firstCount - 1][0].length) : document.createDocumentFragment(),
      last: lastCount ? fragment(words[words.length - lastCount].index, words.at(-1).index + words.at(-1)[0].length) : null,
    };
  }

  function emphasizeLine(line) {
    if (line === activeLine) return;
    if (activeLine) {
      activeLine.classList.remove('reader-line-related', 'reader-line-right');
    }
    activeLine = line;
    if (!line) return;
    const computed = getComputedStyle(line);
    const left = parseFloat(computed.borderLeftWidth);
    line.classList.add('reader-line-related');
    if (!left) line.classList.add('reader-line-right');
  }

  function clearEmphasis() {
    clearHighlight();
    emphasizeLine(null);
  }

  function highlight(underline) {
    if (underline === active) return;
    clearHighlight();
    if (!underline || !underlinesEnabled) return;
    active = underline;
    const related = new Set();
    for (const group of underline.dataset.underlineGroups.split(/\s+/)) {
      for (const id of groups[group] ?? []) {
        const member = underlinesById.get(id);
        if (member?.isConnected && member.getClientRects().length) related.add(member);
      }
    }
    emphasized = [...related];
    underlineOverlay = document.createElement('div');
    underlineOverlay.dataset.readerUnderlineOverlay = '';
    underlineOverlay.setAttribute('aria-hidden', 'true');
    Object.assign(underlineOverlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483000' });
    document.documentElement.append(underlineOverlay);
    for (const element of emphasized) {
      element.classList.add('reader-related');
      drawUnderline(element);
    }
  }

  function toggleSection(section) {
    clearEmphasis();
    lineRegions = null;
    if (section.originalNodes) {
      section.summary.remove();
      section.ornamentStyle?.remove();
      section.ornamentStyle = null;
      for (const node of section.originalNodes) if (node.nodeType === Node.ELEMENT_NODE) delete node.dataset.readerHidden;
      section.originalNodes = null;
      section.summary = null;
      delete section.element.dataset.readerCollapsed;
      for (const line of section.lines) line.setAttribute('aria-expanded', 'true');
      return;
    }
    section.originalNodes = [...section.element.childNodes];
    const computed = getComputedStyle(section.element);
    const fontSize = computed.fontSize;
    const lineHeight = computed.lineHeight;
    const excerpts = excerptContent(section);
    const summary = document.createElement('p');
    summary.className = 'reader-summary';
    summary.style.fontSize = fontSize;
    summary.style.lineHeight = lineHeight;
    summary.setAttribute('aria-label', 'Collapsed section: beginning and ending excerpts');
    summary.title = 'Collapsed section';
    const beginning = document.createElement('span');
    beginning.className = 'reader-excerpt-start';
    beginning.append(excerpts.first);
    const omission = document.createElement('span');
    omission.className = 'reader-omission';
    omission.textContent = '[ \u2026 ]';
    omission.setAttribute('aria-label', 'Text omitted');
    summary.append(beginning, ' ', omission);
    if (excerpts.last) {
      const ending = document.createElement('span');
      ending.className = 'reader-excerpt-end';
      ending.append(excerpts.last);
      summary.append(' ', ending);
    }
    summary.dataset.readerExcerpt = '';
    section.summary = summary;
    const ornaments = section.originalNodes.filter((node) => node.nodeType === Node.ELEMENT_NODE && (node.hasAttribute('data-reader-line') || node.hasAttribute('data-reader-ornament') || [...node.classList].some((name) => name.startsWith('connection-cap--'))));
    const ornamentRules = ornaments.map((node) => {
      const style = getComputedStyle(node);
      const index = [...section.element.children].indexOf(node) + 1;
      return `[data-reader-section="${CSS.escape(section.element.dataset.readerSection)}"][data-reader-collapsed] > :nth-child(${index}) { font-size:${style.fontSize} !important; line-height:${style.lineHeight} !important; }`;
    });
    section.ornamentStyle = document.createElement('style');
    section.ornamentStyle.textContent = ornamentRules.join('\n');
    document.head.append(section.ornamentStyle);
    for (const node of section.originalNodes) if (node.nodeType === Node.ELEMENT_NODE && !ornaments.includes(node)) node.dataset.readerHidden = '';
    section.element.append(summary);
    section.element.dataset.readerCollapsed = 'true';
    for (const line of section.lines) line.setAttribute('aria-expanded', 'false');
  }

  function addReaderControls() {
    const controls = document.createElement('div');
    controls.className = 'reader-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Reading options');
    const simpleLabel = document.createElement('label');
    const simpleToggle = document.createElement('input');
    simpleToggle.type = 'checkbox';
    simpleToggle.checked = true;
    simpleToggle.setAttribute('aria-label', 'Structured layout');
    simpleLabel.append(simpleToggle, ' Structured layout');
    const underlineLabel = document.createElement('label');
    const underlineToggle = document.createElement('input');
    underlineToggle.type = 'checkbox';
    underlineToggle.checked = true;
    underlineToggle.setAttribute('aria-label', 'Show underlines');
    underlineLabel.append(underlineToggle, ' Show underlines');
    controls.append(simpleLabel, underlineLabel);
    document.body.prepend(controls);

    simpleToggle.addEventListener('change', () => {
      if (!simpleToggle.checked) {
        for (const section of sections.values()) if (section.originalNodes) toggleSection(section);
      }
      document.documentElement.classList.toggle('reader-simple-text', !simpleToggle.checked);
      lineRegions = null;
      clearEmphasis();
    });
    underlineToggle.addEventListener('change', () => {
      underlinesEnabled = underlineToggle.checked;
      document.documentElement.classList.toggle('reader-underlines-hidden', !underlinesEnabled);
      clearHighlight();
    });
  }

  function hitLine(clientX, clientY) {
    if (!lineRegions) {
      lineRegions = [];
      for (const line of lines) {
        if (!line.isConnected || !line.getClientRects().length) continue;
        const bounds = line.getBoundingClientRect();
        const style = getComputedStyle(line);
        const left = parseFloat(style.borderLeftWidth);
        const right = parseFloat(style.borderRightWidth);
        if (!left && !right) continue;
        lineRegions.push({ line, top: bounds.top + scrollY, bottom: bounds.bottom + scrollY, height: bounds.height, edge: (left ? bounds.left + left / 2 : bounds.right - right / 2) + scrollX });
      }
    }
    const hits = [];
    for (const region of lineRegions) {
      if (clientY + scrollY < region.top || clientY + scrollY > region.bottom) continue;
      const distance = Math.abs(clientX + scrollX - region.edge);
      if (distance <= 4) hits.push({ ...region, distance });
    }
    hits.sort((first, second) => first.distance - second.distance || first.height - second.height);
    return hits[0]?.line;
  }

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    highlight(event.target instanceof Element ? event.target.closest('[data-underline-id]') : null);
  });

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = null;
      const line = hitLine(event.clientX, event.clientY);
      emphasizeLine(line ?? null);
      if (line) clearHighlight();
    });
  });

  document.addEventListener('pointerout', (event) => {
    const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-underline-id]') : null;
    if (next !== active) highlight(next);
  });

  document.addEventListener('dblclick', (event) => {
    if (event.button !== 0) return;
    const line = hitLine(event.clientX, event.clientY);
    if (!line) return;
    const section = sections.get(line.dataset.readerOwner);
    if (!section) return;
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    toggleSection(section);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clearEmphasis();
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const line = event.target instanceof Element ? event.target.closest('[data-reader-line]') : null;
    if (!line) return;
    event.preventDefault();
    toggleSection(sections.get(line.dataset.readerOwner));
  });

  document.documentElement.addEventListener('pointerleave', clearEmphasis);
  addReaderControls();
  window.addEventListener('blur', clearEmphasis);
  window.addEventListener('beforeprint', clearEmphasis);
  window.addEventListener('resize', () => { lineRegions = null; });
  window.addEventListener('scroll', clearHighlight, true);
  document.fonts.ready.then(() => { lineRegions = null; });
  document.documentElement.dataset.readerReady = 'true';
})();