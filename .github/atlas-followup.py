from pathlib import Path
p=Path('modules/browser-rag-ts/demo/cinematic.css');s=p.read_text()
old='.shell[data-presentation="atlas"] .retrieval-options[open] { position: absolute; bottom: calc(100% + .5rem); left: 1rem; max-height: min(30rem, 60svh); overflow: auto; width: min(32rem, calc(100% - 2rem)); padding: .8rem; border: 1px solid var(--rule); background: #0d0c0a; box-shadow: 0 1rem 3rem #0008; }\n.shell[data-presentation="atlas"] .query-grid { width: 100%; }'
new='''/* Keep the native disclosure control anchored; only its body floats on desktop. */
.shell[data-presentation="atlas"] .retrieval-options { position: relative; }
.shell[data-presentation="atlas"] .query-grid { position: absolute; bottom: calc(100% + .5rem); left: 0; width: min(32rem, calc(100vw - 2.5rem)); max-height: min(30rem, 60svh); overflow: auto; background: #0d0c0a; }'''
assert old in s;s=s.replace(old,new)
old='  .shell[data-presentation="atlas"] .query-meta { gap: .3rem .6rem; }'
assert old in s;s=s.replace(old,old+'\n  .shell[data-presentation="atlas"] .query-grid { position: static; width: 100%; max-height: none; overflow: visible; }')
p.write_text(s)
p=Path('scripts/atlas_presentation.mjs');s=p.read_text()
old="    if (viewport.width === 390) await capture(page, 'atlas-mobile', 'Mobile evidence graph and complete Search controls; natural page scroll.', true);"
new='''    if (viewport.width === 390) {
      await capture(page, 'atlas-mobile', 'Mobile evidence graph and complete Search controls; natural page scroll.', true);
      const settings = page.locator('details.retrieval-options');
      await settings.locator(':scope > summary').click();
      const expanded = await settings.locator('.query-grid').isVisible();
      const outsideGraph = await page.evaluate(() => document.querySelector('.query-grid').getBoundingClientRect().top >= document.querySelector('.graph-pane').getBoundingClientRect().bottom);
      await settings.locator(':scope > summary').click();
      check('mobile retrieval settings open and close without covering the graph', expanded && outsideGraph && !await settings.evaluate(element => element.open));
    }'''
assert old in s;p.write_text(s.replace(old,new))
