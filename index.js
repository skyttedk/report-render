const fs = require("fs-extra");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer-extra");
const express = require("express");

// Use stealth plugin to avoid detection
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
//app.use(express.json());
app.use(express.json({ limit: "100mb" })); // Adjust the limit as needed

let browser; // Declare the browser variable globally

// Function to initialize the Puppeteer browser
async function initializeBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });
  }
}

app.post("/", async (req, res) => {
  try {
    await initializeBrowser();

    const dependencies = req.body.dependencies;
    const layout = req.body.layout;
    const data = req.body.data;
    const fileFormat = req.body.fileFormat;

    // Generate PDF with the received data
    const pdfBuffer = await generatePDF(
      fileFormat,
      dependencies,
      atob(layout),
      data
    );

    // Set response headers for PDF
    if (fileFormat === pdf) {
      res.set("Content-Type", "application/pdf");
    } else if (fileFormat === html) {
      res.set("Content-Type", "text/html");
    }

    // Send the PDF buffer as the response
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

async function generatePDF(dependencies, layout, data) {
  try {
    // Load and compile the template
    const template = Handlebars.compile(layout);

    //const dependenciesString '
    dependencies = dependencies.map((dep) => {
      // type = 0 , means css, 1 ja
      if (dep.type === 0) {
        return `<link rel="stylesheet" href="${dep.url}" />`;
      }
      if (dep.type === 1) {
        return `<script src="${dep.url}"></script>`;
      }
    });

    // Load CSS
    const cssPath = path.resolve(__dirname, "css/style.css");
    const cssContent = await fs.readFile(cssPath, "utf8");

    // Generate HTML
    const html = template(data);

    const completeHtml = `
      <!DOCTYPE html>
      <html lang="da">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Document</title>
          <style>${cssContent}</style>
          ${dependencies.join("")}
        </head>
        <body>
          ${html}
        </body>
      </html>`;

    // Create a new page in the existing browser instance
    const page = await browser.newPage();

    // Set the content of the page to the generated HTML
    await page.setContent(completeHtml, {
      waitUntil: "domcontentloaded",
    });

    if (fileFormat == "html") {
      const html = await page.content();
      await page.close(); // Close the page instead of the browser
      return html;
    } else if (fileFormat == "pdf") {
      const pdfBuffer = await page.pdf({ format: "A4" });
      await page.close(); // Close the page instead of the browser
      return pdfBuffer;
    }
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw error;
  }
}

// Gracefully close the browser instance on server shutdown
process.on("SIGINT", async () => {
  if (browser) {
    await browser.close();
  }
  process.exit();
});
