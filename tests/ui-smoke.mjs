/** Real Chromium renderer check; native process/keyring checks belong to desktop smoke tests. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = 'test-artifacts/ui';
await mkdir(directory,{ recursive:true });
const server = await createServer({ server:{ host:'127.0.0.1',port:5174,strictPort:true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1440,height:1000 } });
  const errors=[];
  page.on('pageerror',(error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5174/tests/visual/index.html');
  await page.getByRole('heading',{ name:'EXAMPLE-101',exact:true }).waitFor();
  await page.getByLabel('Colour theme').selectOption('light');
  await page.screenshot({ path:directory+'/overview-light.png',fullPage:true });
  assert.equal(await page.getByRole('button',{ name:'Approve and continue' }).count(),0);
  await page.getByRole('tab',{ name:'Overview',exact:true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{ name:'Evidence',exact:true }).getAttribute('aria-selected'),'true');
  await page.getByRole('button',{ name:'evidence/verify.log',exact:true }).first().click();
  await page.getByText('Ran 2 tests in 0.280s',{ exact:false }).waitFor();
  await page.screenshot({ path:directory+'/evidence-light.png',fullPage:true });
  await page.getByRole('tab',{ name:'Diff',exact:true }).click();
  await page.getByText('src/api.py',{ exact:false }).first().waitFor();
  await page.getByLabel('Colour theme').selectOption('dark');
  await page.screenshot({ path:directory+'/diff-dark.png',fullPage:true });
  const opener=page.getByRole('button',{ name:/^Commands/ });
  await opener.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
  assert.equal(await opener.evaluate((element) => document.activeElement===element),true);
  await page.getByRole('tab',{ name:'Overview',exact:true }).click();
  await page.getByRole('button',{ name:/EXAMPLE-102/ }).click();
  await page.getByRole('heading',{ name:'Before Green Code' }).waitFor();
  await page.getByText('src',{ exact:true }).waitFor();
  await page.getByText('None · Docker containers',{ exact:true }).waitFor();
  await page.getByRole('button',{ name:'Approve and continue',exact:true }).waitFor();
  await page.screenshot({ path:directory+'/checkpoint-dark.png',fullPage:true });
  await page.setViewportSize({ width:760,height:1000 });
  await page.screenshot({ path:directory+'/checkpoint-narrow.png',fullPage:true });
  assert.deepEqual(errors,[]);
  console.log('Chromium cockpit checks passed; screenshots saved.');
} finally {
  await browser?.close();await server.close();
}
