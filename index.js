import { launch } from 'puppeteer';
import { Solver } from '@2captcha/captcha-solver';
import { readFileSync, writeFileSync } from 'fs';
import { normalizeUserAgent } from './normalize-ua.js';
process.noDeprecation = true;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const solver = new Solver(process.env.APIKEY);

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",
  
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    crimson: "\x1b[38m"
  },
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
    crimson: "\x1b[48m"
  }
};

// Function to format date and time
const formatDate = (date) => {
  const pad = (num) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// Colored logging function with readable timestamp
const colorLog = (type, message) => {
  let colorCode;
  switch(type) {
    case 'INFO':
      colorCode = colors.fg.cyan;
      break;
    case 'SUCCESS':
      colorCode = colors.fg.green;
      break;
    case 'WARNING':
      colorCode = colors.fg.yellow;
      break;
    case 'ERROR':
    case 'CRITICAL':
      colorCode = colors.fg.red;
      break;
    case 'START':
    case 'END':
      colorCode = colors.fg.magenta;
      break;
    default:
      colorCode = colors.reset;
  }
  console.log(`[${formatDate(new Date())}] ${colorCode}[${type}]${colors.reset} ${message}`);
};

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
  } catch (error) {
    colorLog('ERROR', `Failed to click at (${x}, ${y}): ${error.message}`);
  }
}

const processReference = async (reference) => {
  const [email, refCode] = reference.split(':');
  const isCosu = refCode.includes('COSU');
  const proxyConfig = formatProxy(proxies[proxyIndex]);

  colorLog('INFO', `Starting to process reference: ${reference}`);
  const initialUserAgent = await normalizeUserAgent();
  colorLog('INFO', `Normalized User Agent: ${initialUserAgent}`);

  let browser;
  try {
    browser = await launch({
      headless: true,
      args: [
        `--user-agent=${initialUserAgent}`,
        `--proxy-server=${proxyConfig.host}:${proxyConfig.port}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    colorLog('INFO', 'Browser launched in headless mode');

    const [page] = await browser.pages();
    colorLog('INFO', 'Window created');

    await page.setViewport({ width: 800, height: 600 });
    colorLog('INFO', 'Viewport set to 800x600');

    await page.authenticate(proxyConfig.auth);

    const preloadFile = readFileSync('./inject.js', 'utf8');
    await page.evaluateOnNewDocument(preloadFile);

    page.on('console', async (msg) => {
      const txt = msg.text();

      if (txt.includes('intercepted-params:')) {
        const params = JSON.parse(txt.replace('intercepted-params:', ''));
        try {
          colorLog('INFO', 'Solving the captcha...');
          const res = await solver.cloudflareTurnstile(params);
          colorLog('SUCCESS', `Solved the captcha ${res.id}`);
          await page.evaluate((token) => {
            cfCallback(token);
          }, res.data);
        } catch (e) {
          colorLog('ERROR', `Error solving captcha: ${e.err || e.message}`);
          return false;
        }
      }
    });

    await page.goto('https://www.help.tinder.com/hc/en-us/requests/new?ticket_form_id=360000234452');
    colorLog('INFO', 'Navigated to form');
    await sleep(15000);

    colorLog('INFO', 'Performing click...');
    await clickByCoordinates(page, 53, 290);
    colorLog('INFO', 'Clicked CloudFlare box');
    await sleep(1000);
    await clickByCoordinates(page, 53, 290);
    await sleep(3000);
    colorLog('INFO', 'Waiting for captcha to solve');
    await sleep(30000);
    colorLog('INFO', 'Wait completed');

    const setFieldValue = async (selector, value) => {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.evaluate((sel, val) => {
          const element = document.querySelector(sel);
          element.value = val;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }, selector, value);
        colorLog('INFO', `Set field ${selector} to ${value}`);
      } catch (error) {
        colorLog('ERROR', `Failed to set field ${selector}: ${error.message}`);
        throw error;
      }
    };

    colorLog('INFO', 'Filling form fields...');
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

    colorLog('INFO', 'All fields filled successfully');

    colorLog('INFO', 'Submitting the form');
    await page.click('.tinder-btn');
    await sleep(4000);
    colorLog('SUCCESS', 'Form submitted');

    await browser.close();

    return true; // Indicate success
  } catch (error) {
    colorLog('ERROR', `Error occurred while processing ${reference}: ${error.message}`);
    if (browser) {
      await browser.close();
    }
    return false; // Indicate failure
  }
};

const example = async () => {
  colorLog('START', 'Starting to process references...');
  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    colorLog('INFO', `Processing reference ${i + 1}/${references.length}: ${reference}`);
    let success = false;
    let retryCount = 0;
    const maxRetries = 3;

    while (!success && retryCount < maxRetries) {
      try {
        success = await processReference(reference);
        if (success) {
          colorLog('SUCCESS', `Successfully processed reference: ${reference}`);
          
          references.splice(i, 1);
          i--;
          writeFileSync('refs.txt', references.join('\n'));
          
          const timestamp = formatDate(new Date());
          writeFileSync('completed.txt', `${reference},${timestamp}\n`, { flag: 'a' });
        } else {
          colorLog('WARNING', `Failed to process reference: ${reference}. Retrying with a new proxy...`);
          proxyIndex = (proxyIndex + 1) % proxies.length;
          retryCount++;
        }
      } catch (error) {
        colorLog('ERROR', `Error processing reference: ${reference}. Error: ${error.message}`);
        proxyIndex = (proxyIndex + 1) % proxies.length;
        retryCount++;
      }

      if (retryCount < maxRetries && !success) {
        colorLog('INFO', `Waiting before retry ${retryCount + 1}/${maxRetries}...`);
        await sleep(5000 * (retryCount + 1)); // Exponential backoff
      }
    }

    if (!success) {
      colorLog('FAILURE', `Failed to process reference ${reference} after ${maxRetries} attempts. Moving to next reference.`);
      writeFileSync('failed.txt', `${reference}\n`, { flag: 'a' });
    }

    await sleep(1000); // Wait between references
  }

  colorLog('END', 'All references have been processed.');
};

example().catch(error => {
  colorLog('CRITICAL', `Unhandled error in main loop: ${error.message}`);
  colorLog('CRITICAL', `Stack trace: ${error.stack}`);
});


//export APIKEY=ccb96854bb2b9a341ad97f6cc0fefd81