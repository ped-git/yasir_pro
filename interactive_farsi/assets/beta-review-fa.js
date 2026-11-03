(() => {
  const surah = document.getElementById('surah-filter');
  const category = document.getElementById('category-filter');
  const scope = document.getElementById('scope-filter');
  const search = document.getElementById('search-filter');
  const status = document.getElementById('status-filter');
  const sections = [...document.querySelectorAll('.surah')];
  const normalize = (value) => value.normalize('NFC').toLocaleLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/\s+/g, ' ').trim();
  function filter() {
    let visibleItems = 0;
    let visibleSurahs = 0;
    const term = normalize(search.value);
    for (const section of sections) {
      const eligible = (!surah.value || section.dataset.surah === surah.value) && (!scope.value || section.dataset.reference === scope.value);
      let matches = 0;
      for (const item of section.querySelectorAll('.review-item')) {
        item.hidden = !eligible || Boolean(status.value && item.dataset.status !== status.value) || Boolean(category.value && item.dataset.category !== category.value) || Boolean(term && !item.dataset.search.includes(term));
        if (!item.hidden) matches++;
      }
      section.hidden = !eligible || Boolean((status.value || category.value || term) && !matches);
      if (!section.hidden) { visibleSurahs++; visibleItems += matches; }
    }
    document.getElementById('visible-count').textContent = `${visibleItems} مورد در ${visibleSurahs} سوره`;
    document.getElementById('empty-state').hidden = visibleSurahs > 0;
  }
  for (const control of [surah, category, scope, search, status]) control.addEventListener('input', filter);
  document.getElementById('expand-all').addEventListener('click', () => {
    for (const section of sections.filter((section) => !section.hidden)) for (const item of section.querySelectorAll('.review-item:not([hidden])')) item.open = true;
  });
  document.getElementById('collapse-all').addEventListener('click', () => {
    for (const section of sections.filter((section) => !section.hidden)) for (const item of section.querySelectorAll('.review-item:not([hidden])')) item.open = false;
  });
  document.getElementById('reset-filters').addEventListener('click', () => {
    surah.value = ''; category.value = ''; scope.value = ''; search.value = ''; status.value = 'decision'; filter();
  });
  document.querySelector('.filters').addEventListener('submit', (event) => event.preventDefault());
  const rows = [...document.querySelectorAll('#underline-inventory tbody tr')];
  const inventoryState = document.getElementById('inventory-state');
  const inventorySurah = document.getElementById('inventory-surah');
  const inventorySearch = document.getElementById('inventory-search');
  function filterInventory() {
    const term = normalize(inventorySearch.value);
    let visible = 0;
    for (const row of rows) {
      row.hidden = Boolean(inventoryState.value && row.dataset.status !== inventoryState.value) || Boolean(inventorySurah.value && row.dataset.surah !== inventorySurah.value) || Boolean(term && !row.dataset.search.includes(term));
      if (!row.hidden) visible++;
    }
    document.getElementById('inventory-count').textContent = `${visible} آیه در این نما`;
  }
  for (const control of [inventoryState, inventorySurah, inventorySearch]) control.addEventListener('input', filterInventory);
  filterInventory();
  filter();
})();