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
  try {
    await page.mouse.click(x, y);
    console.log(`Clicked at coordinates (${x}, ${y})`);
  } catch (error) {
    console.error(`Failed to click at coordinates (${x}, ${y}): ${error.message}`);
  }
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
          console.error('Error solving captcha:', e.err || e.message);
          // Instead of throwing, we'll return false to indicate failure
          return false;
        }
      }
    });

    console.log('Navigating to the page...');
    await page.goto('https://www.help.tinder.com/hc/en-us/requests/new?ticket_form_id=360000234452');
    console.log('Page loaded');
    await sleep(15000);

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

    // Helper function to set field values without focus
    const setFieldValue = async (selector, value) => {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.evaluate((sel, val) => {
          const element = document.querySelector(sel);
          element.value = val;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }, selector, value);
        console.log(`Field ${selector} set to: ${value}`);
      } catch (error) {
        console.error(`Failed to set field ${selector}: ${error.message}`);
        throw error;
      }
    };

    // Set values for all fields
    await sleep(1000);
    await setFieldValue('#request_custom_fields_360013981632', 'f_refund_request');
    await sleep(1000);
    await setFieldValue('#request_custom_fields_360013898451', 'f_web');
    await sleep(1000);
    await setFieldValue('#request_custom_fields_360013897951', email);
    await sleep(1000);
    await setFieldValue('#request_custom_fields_360013867472', refCode);
    await sleep(1000);

    const description = spin(isCosu ? cosuDescriptions[Math.floor(Math.random() * cosuDescriptions.length)] : tndrDescriptions[Math.floor(Math.random() * tndrDescriptions.length)]);
    await setFieldValue('#request_description', description);
    await sleep(1000);

    console.log('All fields filled successfully');

    await sleep(1000);
    await page.click('.tinder-btn');
    await sleep(4000);
    console.log('Operation complete. Closing browser...');
    await browser.close();
    console.log('Browser closed. Script finished.');

    return true; // Indicate success
  } catch (error) {
    console.error(`Error occurred: ${error.message}`);
    if (browser) {
      await browser.close();
    }
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
      let retryCount = 0;
      const maxRetries = 3;

      while (!success && retryCount < maxRetries) {
        try {
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
            retryCount++;
          }
        } catch (error) {
          console.error(`Error processing reference: ${reference}. Error: ${error.message}`);
          proxyIndex = (proxyIndex + 1) % proxies.length;
          retryCount++;
        }

        if (retryCount < maxRetries) {
          console.log(`Waiting before retry ${retryCount + 1}/${maxRetries}...`);
          await sleep(5000 * (retryCount + 1)); // Exponential backoff
        }
      }

      if (!success) {
        console.log(`Failed to process reference ${reference} after ${maxRetries} attempts. Moving to next reference.`);
        // Optionally, you could add this reference to a 'failed.txt' file
        writeFileSync('failed.txt', `${reference}\n`, { flag: 'a' });
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

  console.log('All references have been processed.');
};

example().catch(error => {
  console.error('Unhandled error in main loop:', error);
  // Optionally, you could implement a restart mechanism here
  // For example:
  // setTimeout(() => {
  //   console.log('Restarting the script...');
  //   example();
  // }, 60000);
});