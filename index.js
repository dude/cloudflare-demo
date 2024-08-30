import { launch } from 'puppeteer';
import { Solver } from '@2captcha/captcha-solver';
import { readFileSync, writeFileSync } from 'fs';
import { normalizeUserAgent } from './normalize-ua.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const solver = new Solver(process.env.APIKEY);

// Read files
let proxies = readFileSync('proxies.txt', 'utf8').trim().split('\n');
let references = readFileSync('refs.txt', 'utf8').trim().split('\n');
const cosuDescriptions = readFileSync('COSU_description.txt', 'utf8').trim().split('\n');
const tndrDescriptions = readFileSync('TNDR_description.txt', 'utf8').trim().split('\n');

let proxyIndex = 0;

const spin = (spintax) => {
  const regex = /{([^{}]*)}/;
  let result = spintax;
  let match;
  while ((match = regex.exec(result)) !== null) {
    const options = match[1].split('|');
    const replacement = options[Math.floor(Math.random() * options.length)];
    result = result.replace(match[0], replacement);
  }
  return result.trim();
};

const formatProxy = (proxyString) => {
  const [auth, host] = proxyString.split('@');
  const [username, password] = auth.split(':');
  return {
    host: host.split(':')[0],
    port: host.split(':')[1],
    auth: { username, password }
  };
};

async function clickByCoordinates(page, x, y) {
  await page.mouse.click(x, y);
  console.log(`Clicked at coordinates (${x}, ${y})`);
}

const processReference = async (reference) => {
  const [email, refCode] = reference.split(':');
  const isCosu = refCode.includes('COSU');
  const proxyConfig = formatProxy(proxies[proxyIndex]);

  console.log('Starting the script...');
  const initialUserAgent = await normalizeUserAgent();
  console.log(`Normalized User Agent: ${initialUserAgent}`);

  let browser;
  try {
    browser = await launch({
      headless: false,
      devtools: true,
      args: [
        `--user-agent=${initialUserAgent}`,
        `--proxy-server=${proxyConfig.host}:${proxyConfig.port}`,
      ],
    });
    console.log('Browser launched');

    const [page] = await browser.pages();
    console.log('Page created');

    // Set a specific window size
    await page.setViewport({ width: 800, height: 600 });
    console.log('Viewport set to 800x600');

    await page.authenticate(proxyConfig.auth);

    const preloadFile = readFileSync('./inject.js', 'utf8');
    await page.evaluateOnNewDocument(preloadFile);
    console.log('Preload file evaluated');

    page.on('console', async (msg) => {
      const txt = msg.text();
      console.log(`Console log: ${txt}`);

      if (txt.includes('intercepted-params:')) {
        const params = JSON.parse(txt.replace('intercepted-params:', ''));
        console.log('Intercepted params:', params);
        try {
          console.log(`Solving the captcha...`);
          const res = await solver.cloudflareTurnstile(params);
          console.log(`Solved the captcha ${res.id}`);
          console.log('Captcha solution:', res);
          await page.evaluate((token) => {
            cfCallback(token);
          }, res.data);
        } catch (e) {
          console.error('Error solving captcha:', e.err);
          throw e;
        }
      }
    });

    console.log('Navigating to the page...');
    await page.goto('https://www.help.tinder.com/hc/en-us/requests/new?ticket_form_id=360000234452');
    console.log('Page loaded');
    await sleep(10000);

    console.log('Clicking');
    await clickByCoordinates(page, 53, 290);
    console.log('Done Click');
    await sleep(1000);
    console.log('Clicking');
    await clickByCoordinates(page, 53, 290);
    console.log('Done Click');
    await sleep(3000);
    console.log('Waiting for 20 seconds');
    await sleep(30000);
    console.log('Wait complete');

    console.log('Searching for input element...');
    const element = await page.waitForSelector('#request_custom_fields_360013981632', { timeout: 30000 });
    if (!element) {
      throw new Error('Input element not found');
    }
    console.log('Input element found');

    console.log('Modifying the value...');
    await page.evaluate(() => {
      const input = document.querySelector('#request_custom_fields_360013981632');
      const oldValue = input.value;
      input.value = 'f_refund_request';
      console.log(`Input value changed from '${oldValue}' to '${input.value}'`);
    });

    console.log('Verifying the change...');
    const newValue = await page.evaluate(() => {
      return document.querySelector('#request_custom_fields_360013981632').value;
    });
    console.log(`New value verified: ${newValue}`);

    await sleep(1000);
    console.log('Searching for input element...');
    const element2 = await page.waitForSelector('#request_custom_fields_360013898451');
    console.log('Input element found');

    console.log('Modifying the value...');
    await page.evaluate(() => {
      const input = document.querySelector('#request_custom_fields_360013898451');
      const oldValue = input.value;
      input.value = 'f_web';
      console.log(`Input value changed from '${oldValue}' to '${input.value}'`);
    });

    console.log('Verifying the change...');
    const newValue2 = await page.evaluate(() => {
      return document.querySelector('#request_custom_fields_360013898451').value;
    });
    console.log(`New value verified: ${newValue2}`);

    await sleep(1000);
    await page.type('#request_custom_fields_360013897951', email);
    await sleep(1000);
    await page.type('#request_custom_fields_360013867472', refCode);
    await sleep(1000);

    const description = spin(isCosu ? cosuDescriptions[Math.floor(Math.random() * cosuDescriptions.length)] : tndrDescriptions[Math.floor(Math.random() * tndrDescriptions.length)]);
    await page.type('#request_description', description);

    await sleep(1000);
    await page.click('.tinder-btn');
    await sleep(4000);
    console.log('Operation complete. Closing browser...');
    await browser.close();
    console.log('Browser closed. Script finished.');

    return true; // Indicate success
  } catch (error) {
    console.error(`Error occurred: ${error.message}`);
    await browser?.close();
    return false; // Indicate failure
  }
};

const example = async () => {
  let referenceIndex = 0;
  let completedReferences = new Set();

  while (completedReferences.size < references.length) {
    const reference = references[referenceIndex];
    
    if (!completedReferences.has(reference)) {
      console.log(`Processing reference: ${reference}`);
      let success = false;

      while (!success) {
        success = await processReference(reference);
        if (success) {
          console.log(`Successfully processed reference: ${reference}`);
          completedReferences.add(reference);
          
          // Remove the processed reference from refs.txt and add to completed.txt
          references = references.filter(ref => ref !== reference);
          writeFileSync('refs.txt', references.join('\n'));
          
          const timestamp = new Date().toISOString();
          writeFileSync('completed.txt', `${reference},${timestamp}\n`, { flag: 'a' });
        } else {
          console.log(`Failed to process reference: ${reference}. Retrying with a new proxy...`);
          proxyIndex = (proxyIndex + 1) % proxies.length;
          await sleep(1000); // Wait before retrying
        }
      }
    }

    // Move to the next reference, or wrap around to the beginning if we've reached the end
    referenceIndex = (referenceIndex + 1) % references.length;
    
    // If we've wrapped around, reload the references from the file
    if (referenceIndex === 0) {
      references = readFileSync('refs.txt', 'utf8').trim().split('\n');
      console.log('Reloaded references from file.');
    }

    await sleep(1000); // Wait between references
  }

  console.log('All references have been processed successfully.');
};

example();