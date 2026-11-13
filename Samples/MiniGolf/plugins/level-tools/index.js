// A small example plugin. Commands appear in Piston's Plugins menu; every change is one undo step.
const GRID = 16;

// The entities the user has selected, or all of them if nothing is selected.
const targets = (scene, ctx) => scene.entities.filter(e => !ctx.selection.length || ctx.selection.includes(e.sceneKey));

export default {
  activate(piston) {
    piston.commands.register('snap', (ctx) => {
      piston.scene.edit('Snap to grid', (scene) => {
        for (const e of targets(scene, ctx)) {
          e.transform.position.x = Math.round(e.transform.position.x / GRID) * GRID;
          e.transform.position.y = Math.round(e.transform.position.y / GRID) * GRID;
        }
      });
      piston.notify(`Snapped to a ${GRID}px grid`);
    });

    piston.commands.register('alignLeft', (ctx) => {
      if (ctx.selection.length < 2) return piston.notify('Select two or more entities first');
      piston.scene.edit('Align left', (scene) => {
        const picked = targets(scene, ctx);
        const left = Math.min(...picked.map(e => e.transform.position.x));
        picked.forEach(e => { e.transform.position.x = left; });
      });
    });

    piston.commands.register('distribute', (ctx) => {
      if (ctx.selection.length < 3) return piston.notify('Select three or more entities first');
      piston.scene.edit('Space evenly', (scene) => {
        const picked = targets(scene, ctx).sort((a, b) => a.transform.position.x - b.transform.position.x);
        const first = picked[0].transform.position.x, last = picked[picked.length - 1].transform.position.x;
        picked.forEach((e, i) => { e.transform.position.x = first + (last - first) * i / (picked.length - 1); });
      });
    });
  },
};
