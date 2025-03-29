const fs = require("fs-extra");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer-extra");
const express = require("express");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { performance } = require('perf_hooks');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CSS_PATH = path.resolve(__dirname, "css/style.css");
const MAX_REQUEST_SIZE = "100mb";
const MAX_DATA_FILES = 50; //  Maximum number of data files to keep

// Ensure data directory exists

fs.ensureDirSync(DATA_DIR);

// Middleware to parse JSON bodies with increased limit
app.use(express.json({ limit: MAX_REQUEST_SIZE }));

// Global browser instance
let browser;
let browserStartTime;

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', function (date, format) {
  // Simple date formatter - expand as needed
  const d = new Date(date);
  return d.toLocaleDateString();
});

Handlebars.registerHelper('ifEquals', function (arg1, arg2, options) {
  return (arg1 === arg2) ? options.fn(this) : options.inverse(this);
});

// Function to initialize the Puppeteer browser
async function initializeBrowser() {
  // If browser exists but has been running too long (12 hours), restart it
  const BROWSER_MAX_LIFETIME = 12 * 60 * 60 * 1000; // 12 hours in ms

  if (browser && browserStartTime && (Date.now() - browserStartTime > BROWSER_MAX_LIFETIME)) {
    console.log("Browser lifetime exceeded, restarting...");
    await browser.close();
    browser = null;
  }

  if (!browser) {
    console.log("Initializing browser...");
    browserStartTime = Date.now();
    browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu"
      ],
      headless: true,
    });

    // Set up event listeners for browser crashes
    browser.on('disconnected', () => {
      console.log('Browser disconnected, will reinitialize on next request');
      browser = null;
    });
  }
  return browser;
}

// Clean up old data files
async function cleanupDataFiles() {
  try {
    const files = await fs.readdir(DATA_DIR);
    const dataFiles = files.filter(file => file.startsWith('data_') && file.endsWith('.json'));

    if (dataFiles.length > MAX_DATA_FILES) {
      // Sort by creation time, oldest first
      const sortedFiles = dataFiles.map(file => {
        const filePath = path.join(DATA_DIR, file);
        return {
          name: file,
          path: filePath,
          ctime: fs.statSync(filePath).ctime.getTime()
        };
      }).sort((a, b) => a.ctime - b.ctime);

      // Remove the oldest files
      const filesToRemove = sortedFiles.slice(0, sortedFiles.length - MAX_DATA_FILES);
      for (const file of filesToRemove) {
        await fs.unlink(file.path);
        console.log(`Removed old data file: ${file.name}`);
      }
    }
  } catch (error) {
    console.error("Error cleaning up data files:", error);
  }
}

// Validate external dependencies
async function validateDependencies(deps, page) {
  const failures = [];
  for (const dep of deps) {
    if (dep.url) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(dep.url, {
          method: 'HEAD',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          failures.push(`Failed to load: ${dep.url} (${response.status})`);
        }
      } catch (err) {
        failures.push(`Error loading: ${dep.url}: ${err.message}`);
      }
    }
  }
  return failures;
}

// GET endpoint to retrieve a specific data file
app.get("/data/:id", async (req, res) => {
  try {
    const dataPath = path.join(DATA_DIR, `data_${req.params.id}.json`);
    if (!await fs.pathExists(dataPath)) {
      return res.status(404).json({ error: "Data file not found" });
    }

    const data = await fs.readFile(dataPath, 'utf8');
    res.send(data);
  } catch (error) {
    console.error("Error retrieving data:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET endpoint to list all data files
app.get("/data", async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const dataFiles = files
      .filter(file => file.startsWith('data_') && file.endsWith('.json'))
      .map(file => ({
        id: file.replace(/^data_(.+)\.json$/, '$1'),
        path: `/data/${file.replace(/^data_(.+)\.json$/, '$1')}`,
        size: fs.statSync(path.join(DATA_DIR, file)).size,
        created: fs.statSync(path.join(DATA_DIR, file)).ctime
      }));

    res.json(dataFiles);
  } catch (error) {
    console.error("Error listing data files:", error);
    res.status(500).json({ error: error.message });
  }
});

// Main document generation function
async function generateDocument(fileFormat, dependencies, layout, data, pdfOptions = {}) {
  let page;

  try {
    // Load and compile the template
    const template = Handlebars.compile(layout);

    // Format dependencies
    const dependenciesHtml = dependencies.map(dep => {
      if (dep.type === 0) { // CSS
        return `<link rel="stylesheet" href="${dep.url}" />`;
      }
      if (dep.type === 1) { // JS
        return `<script src="${dep.url}"></script>`;
      }
      return '';
    }).join('');

    // Generate HTML from template
    const contentHtml = template(data);

    // Create complete HTML document
    const completeHtml = `
      <!DOCTYPE html>
      <html lang="da">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Generated Document</title>
          ${dependenciesHtml}
        </head>
        <body>
          ${contentHtml}
        </body>
      </html>`;

    // Create a new page
    page = await browser.newPage();

    // Set default viewport for A4 at 96 DPI
    await page.setViewport({
      width: 794, // A4 width at 96 DPI
      height: 1123, // A4 height at 96 DPI
      deviceScaleFactor: 1,
    });

    // Set the content and wait for all resources to load
    await page.setContent(completeHtml, {
      waitUntil: "networkidle0",
      timeout: 30000 // 30 second timeout
    });

    // Add CSS after content is loaded
    if (await fs.pathExists(CSS_PATH)) {
      const cssContent = await fs.readFile(CSS_PATH, 'utf8');
      await page.addStyleTag({ content: cssContent });
    }

    // Set screen media type (for proper rendering)
    await page.emulateMediaType("screen");

    // Calculate the total number of pages (for pagination)
    const totalPages = await page.evaluate(() => {
      return Math.ceil(
        document.documentElement.scrollHeight / window.innerHeight
      );
    });
    console.log(`Document has ${totalPages} virtual pages`);

    // Update page number placeholders
    await page.evaluate((totalPages) => {
      // Update total pages placeholders
      const totalPagesElements = document.querySelectorAll(
        '[data-placeholder="totalPages"]'
      );
      totalPagesElements.forEach((el) => {
        el.textContent = totalPages;
      });

      // Set up current page tracking
      const pageNumberElements = document.querySelectorAll(
        '[data-placeholder="pageNumber"]'
      );

      if (pageNumberElements.length > 0) {
        let currentPage = 1;

        const updatePageNumbers = () => {
          currentPage = Math.ceil(window.scrollY / window.innerHeight) + 1;
          pageNumberElements.forEach((el) => {
            el.textContent = currentPage;
          });
        };

        // Update on scroll
        window.addEventListener("scroll", updatePageNumbers);

        // Initial update
        updatePageNumbers();
      }
    }, totalPages);

    // Return HTML or PDF based on requested format
    if (fileFormat === "html") {
      const html = await page.content();
      return html;
    } else if (fileFormat === "pdf") {
      // Merge default PDF options with provided options
      const mergedPdfOptions = {
        format: "A4",
        printBackground: true,
        margin: { top: "40px", bottom: "40px", left: "40px", right: "40px" },
        ...pdfOptions
      };

      const pdfBuffer = await page.pdf(mergedPdfOptions);
      return pdfBuffer;
    } else {
      throw new Error(`Unsupported output format: ${fileFormat}`);
    }
  } catch (error) {
    console.error("Error in document generation:", error);
    throw error;
  } finally {
    // Always close the page to prevent memory leaks
    if (page) {
      await page.close();
    }
  }
}

// Main PDF/HTML generation endpoint
app.post("/generate", async (req, res) => {
  const startTime = performance.now();
  console.log(`[${new Date().toISOString()}] Received document generation request`);

  try {
    // Initialize browser if needed
    await initializeBrowser();

    // Save request data
    const timestamp = Date.now();
    const dataPath = path.join(DATA_DIR, `data_${timestamp}.json`);
    await fs.writeJson(dataPath, req.body, { spaces: 2 });
    console.log(`Request data saved to ${dataPath}`);

    // Schedule cleanup of old files
    cleanupDataFiles();

    // Extract request data
    const {
      dependencies = [],
      layout,
      data,
      fileFormat = 'pdf',
      pdfOptions = {}
    } = req.body;

    if (!layout) {
      return res.status(400).json({ error: "Layout template is required" });
    }

    // Decode layout (base64)
    const decodedLayout = Buffer.from(layout, 'base64').toString('utf-8');

    // Validate dependencies
    const dependencyFailures = await validateDependencies(dependencies);
    if (dependencyFailures.length > 0) {
      console.warn("Dependency validation failures:", dependencyFailures);
    }

    // Generate document
    const output = await generateDocument(
      fileFormat,
      dependencies,
      decodedLayout,
      typeof data === 'string' ? JSON.parse(data) : data,
      pdfOptions
    );

    // Set response headers
    if (fileFormat === "pdf") {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="document-${timestamp}.pdf"`
      });
    } else if (fileFormat === "html") {
      res.set('Content-Type', 'text/html');
    }

    // Send the output
    res.send(output);

    const endTime = performance.now();
    console.log(`Document generated in ${((endTime - startTime) / 1000).toFixed(2)}s`);

  } catch (error) {
    console.error("Error generating document:", error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Legacy endpoint for backward compatibility - FIXED VERSION
app.post("/", async (req, res) => {
  console.log("Legacy endpoint called, forwarding to /generate handler");

  // Simply apply the same logic as the /generate endpoint
  // This is the proper way to handle the request instead of using app.handle()
  const startTime = performance.now();

  try {
    // Initialize browser if needed
    await initializeBrowser();

    // Save request data
    const timestamp = Date.now();
    const dataPath = path.join(DATA_DIR, `data_${timestamp}.json`);
    await fs.writeJson(dataPath, req.body, { spaces: 2 });
    console.log(`Request data saved to ${dataPath}`);

    // Extract request data
    const {
      dependencies = [],
      layout,
      data,
      fileFormat = 'pdf',
      pdfOptions = {}
    } = req.body;

    if (!layout) {
      return res.status(400).json({ error: "Layout template is required" });
    }

    // Decode layout (base64)
    const decodedLayout = Buffer.from(layout, 'base64').toString('utf-8');

    // Generate document
    const output = await generateDocument(
      fileFormat,
      dependencies,
      decodedLayout,
      typeof data === 'string' ? JSON.parse(data) : data,
      pdfOptions
    );

    // Set response headers
    if (fileFormat === "pdf") {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="document-${timestamp}.pdf"`
      });
    } else if (fileFormat === "html") {
      res.set('Content-Type', 'text/html');
    }

    // Send the output
    res.send(output);

    const endTime = performance.now();
    console.log(`Document generated in ${((endTime - startTime) / 1000).toFixed(2)}s`);

  } catch (error) {
    console.error("Error generating document:", error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Check if browser can be initialized
    await initializeBrowser();
    res.json({
      status: "healthy",
      uptime: process.uptime(),
      browserUptime: browser ? (Date.now() - browserStartTime) / 1000 : 0
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: error.message
    });
  }
});

// Start the server
app.listen(port, async () => {
  console.log(`
========================================================
  PDF/HTML Generation Service
  Server running on port ${port}
  Environment: ${process.env.NODE_ENV || 'development'}
  Press Ctrl+C to shutdown
========================================================
  `);

  // Pre-initialize browser on startup
  try {
    await initializeBrowser();
    console.log("Browser successfully pre-initialized");
  } catch (error) {
    console.error("Failed to pre-initialize browser:", error);
  }
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  // Close browser if it exists
  if (browser) {
    console.log("Closing browser...");
    await browser.close();
    browser = null;
  }

  console.log("Shutdown complete");
  process.exit(0);
};

// Handle various termination signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// Handle uncaught exceptions to prevent crashing
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  if (browser) {
    browser.close().catch(console.error);
  }
  process.exit(1);
});
