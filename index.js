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
app.use(express.json());

// POST endpoint to handle JSON data
app.post("/", async (req, res) => {
  try {
    const data = req.body;

    // Generate PDF with the received data
    const base64Pdf = await generatePDF(data);

    res.status(200).text(base64Pdf);
    //.json({ message: "PDF Generated Successfully!", pdf: base64Pdf });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

async function generatePDF(data) {
  try {
    // Load and compile the template
    const templatePath = path.resolve(__dirname, "templates/hello.hbs");
    const templateHtml = await fs.readFile(templatePath, "utf8");
    const template = Handlebars.compile(templateHtml);

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
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.13.1/css/all.min.css" />
          <link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/css/bootstrap.min.css'>
          <script src='https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/js/bootstrap.bundle.min.js'></script>
        </head>
        <body>
          ${html}
        </body>
      </html>`;

    // Launch Puppeteer and create a new page
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });
    const page = await browser.newPage();

    // Set the content of the page to the generated HTML
    await page.setContent(completeHtml, {
      waitUntil: "domcontentloaded",
    });

    // Create PDF from page content
    const pdfBuffer = await page.pdf({ format: "A4" });

    await browser.close();

    // Convert PDF buffer to base64
    const base64Pdf = pdfBuffer.toString("base64");

    console.log("PDF Generated Successfully!");

    return base64Pdf;
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw error;
  }
}
