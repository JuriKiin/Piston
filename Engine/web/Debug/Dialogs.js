/**
 * Stand-ins for window.confirm/prompt - this browser context doesn't support the native blocking
 * dialogs (they throw "not supported" outright), so every yes/no or free-text decision anywhere in
 * the editor UI goes through one of these small in-page modals instead. Originally lived on
 * DevToolbar alone; pulled out standalone once Inspector needed the same prompt (naming a new
 * prefab) rather than duplicating the same overlay/panel chrome a second time.
 */
export function confirmDialog(message) {
    return new Promise((resolve) => {
        const { overlay, panel } = buildDialogChrome(message);

        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';

        const cancelBtn = makeButton('Cancel', () => { overlay.remove(); resolve(false); });
        const okBtn = makeButton('OK', () => { overlay.remove(); resolve(true); });
        okBtn.style.background = '#2d5a2d';

        buttonRow.append(cancelBtn, okBtn);
        panel.appendChild(buttonRow);
        document.body.appendChild(overlay);
    });
}

export function promptDialog(message, defaultValue = '') {
    return new Promise((resolve) => {
        const { overlay, panel } = buildDialogChrome(message);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue;
        input.style.cssText = 'width:100%; box-sizing:border-box; background:#262626; color:#ddd; border:1px solid #3a3a3a; border-radius:3px; padding:5px 7px; font:inherit; margin-bottom:10px;';

        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';

        const finish = (value) => { overlay.remove(); resolve(value); };
        const cancelBtn = makeButton('Cancel', () => finish(null));
        const okBtn = makeButton('OK', () => finish(input.value));
        okBtn.style.background = '#2d5a2d';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') finish(input.value);
            else if (e.key === 'Escape') finish(null);
        });

        buttonRow.append(cancelBtn, okBtn);
        panel.append(input, buttonRow);
        document.body.appendChild(overlay);
        input.focus();
        input.select();
    });
}

/** Shared overlay/panel/message chrome both dialogs above build on top of. */
function buildDialogChrome(message) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:1000; display:flex; align-items:center; justify-content:center;';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:#1e1e1e; border:1px solid #3a3a3a; border-radius:8px; padding:16px; min-width:280px; max-width:90vw; display:flex; flex-direction:column; gap:10px; font:12px system-ui, sans-serif; color:#ddd;';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const text = document.createElement('div');
    text.textContent = message;
    text.style.cssText = 'line-height:1.4;';

    panel.appendChild(text);
    overlay.appendChild(panel);
    return { overlay, panel };
}

function makeButton(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
        cursor: pointer; border: none; border-radius: 4px;
        padding: 4px 8px; font: inherit; background: #3a3a3a; color: #fff;
    `;
    btn.addEventListener('click', onClick);
    return btn;
}
