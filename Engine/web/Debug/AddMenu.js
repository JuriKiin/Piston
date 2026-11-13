import { EntityRegistry } from '../EntityRegistry.js';
import { PrefabRegistry } from '../PrefabRegistry.js';

/**
 * The "Add" picker: an Entity/Prefab tab toggle, a search box, and a grouped result list - built
 * once here rather than twice, since both the top bar's own "+ Add ▾" dropdown and the Inspector's
 * right-click-on-empty-space menu need exactly the same picker and would otherwise drift into two
 * slightly different implementations. `onPick(kind, key)` fires when something's chosen - kind is
 * 'entity' (key is the EntityRegistry name) or 'prefab' (key is the prefab id) - the caller decides
 * what "adding" actually means (GameLoop#addEntityFromRegistry / #addPrefabInstance) and how to
 * close whichever popup is hosting this.
 */
export function buildAddMenuContent(onPick) {
    const root = document.createElement('div');
    root.style.cssText = 'width:200px; display:flex; flex-direction:column; gap:4px;';

    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex; gap:2px;';

    const tabButton = (label) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = 'flex:1; cursor:pointer; border:none; border-radius:4px; padding:4px 2px; font:11px system-ui, sans-serif; background:#3a3a3a; color:#fff;';
        return btn;
    };
    const entityTabBtn = tabButton('Entity');
    const prefabTabBtn = tabButton('Prefab');
    tabs.append(entityTabBtn, prefabTabBtn);

    const search = document.createElement('input');
    search.type = 'text';
    search.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: #262626; color: #ddd; border: 1px solid #3a3a3a; border-radius: 3px; padding: 3px 5px; font: inherit;
    `;

    const results = document.createElement('div');
    results.style.cssText = 'max-height:280px; overflow-y:auto;';

    const groupHeader = (label) => {
        const header = document.createElement('div');
        header.textContent = label;
        header.style.cssText = 'opacity:0.6; text-transform:uppercase; font-size:10px; letter-spacing:0.05em; margin:4px 2px 2px;';
        return header;
    };
    const resultItem = (label, onClick) => {
        const item = document.createElement('div');
        item.textContent = label;
        item.style.cssText = 'padding:5px 8px; cursor:pointer; border-radius:3px; white-space:nowrap;';
        item.addEventListener('mouseenter', () => item.style.background = '#333');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('click', onClick);
        return item;
    };
    const emptyRow = (label) => {
        const empty = document.createElement('div');
        empty.style.cssText = 'opacity:0.5; padding:4px 6px;';
        empty.textContent = label;
        return empty;
    };

    let activeTab = 'entity';

    const renderResults = () => {
        results.innerHTML = '';
        if (activeTab === 'entity') {
            const groups = EntityRegistry.search(search.value);
            if (groups.size === 0) { results.appendChild(emptyRow('No matches')); return; }
            for (const [groupName, entries] of groups) {
                results.appendChild(groupHeader(groupName));
                for (const { name } of entries) {
                    results.appendChild(resultItem(name, () => onPick('entity', name)));
                }
            }
        } else {
            const matches = PrefabRegistry.search(search.value);
            if (matches.length === 0) {
                results.appendChild(emptyRow(PrefabRegistry.list().length === 0 ? 'No prefabs saved yet' : 'No matches'));
                return;
            }
            for (const { id, name } of matches) {
                results.appendChild(resultItem(name, () => onPick('prefab', id)));
            }
        }
    };

    const setTab = (tab) => {
        activeTab = tab;
        entityTabBtn.style.background = tab === 'entity' ? '#4da6ff' : '#3a3a3a';
        entityTabBtn.style.color = tab === 'entity' ? '#111' : '#fff';
        prefabTabBtn.style.background = tab === 'prefab' ? '#4da6ff' : '#3a3a3a';
        prefabTabBtn.style.color = tab === 'prefab' ? '#111' : '#fff';
        search.placeholder = tab === 'entity' ? 'Search entities...' : 'Search prefabs...';
        if (tab === 'prefab') {
            // Fetched lazily (only once the Prefab tab is actually opened, not on every Add-menu
            // open) and cached by PrefabRegistry itself - re-rendering after it resolves is what
            // turns a first-open "No prefabs saved yet" into the real list once it's in.
            PrefabRegistry.ensureLoaded().then(renderResults);
        }
        renderResults();
    };

    entityTabBtn.addEventListener('click', () => setTab('entity'));
    prefabTabBtn.addEventListener('click', () => setTab('prefab'));
    search.addEventListener('input', renderResults);

    setTab('entity');
    root.append(tabs, search, results);
    return root;
}
