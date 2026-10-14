from pathlib import Path
p=Path('scripts/browser_rag_smoke.mjs');s=p.read_text()
old='  // Mobile Atlas keeps the graph visible while evidence stacks below Search.'
new='''  // Close setup surfaces before exercising actual, unobstructed canvas input.
  for (const selector of ["details.collection-disclosure", "details.retrieval-options"]) {
    const disclosure = targetPage.locator(selector);
    if (await disclosure.evaluate(element => element.open)) await disclosure.locator(":scope > summary").click();
  }
  // Mobile Atlas keeps the graph visible while evidence stacks below Search.'''
assert old in s;s=s.replace(old,new)
s=s.replace('''        return true;
      } finally {
        await mobilePage.close();
      }
    });
  }
  await verify("managed_resize_rotation"''','''        return true;
      } catch (error) {
        await mobilePage.screenshot({ path: join(reportDir, `failed-mobile-${requestedBackend}.png`), fullPage: true }).catch(() => undefined);
        throw error;
      } finally {
        await mobilePage.close();
      }
    });
  }
  await verify("managed_resize_rotation"''')
p.write_text(s)
p=Path('scripts/atlas_presentation.mjs');s=p.read_text();old="    backend: await page.locator('#renderer-state').textContent(), sha256: sha256(bytes), bytes: bytes.length });";new="    backend: await page.locator('#graph-tsl-canvas').evaluate(canvas => JSON.parse(canvas.dataset.rendererDiagnostics ?? '{}').selected_backend ?? 'svg'),\n    backend_status: await page.locator('#renderer-state').textContent(), sha256: sha256(bytes), bytes: bytes.length });";assert old in s;p.write_text(s.replace(old,new))
