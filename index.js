const fs = require("fs-extra");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// POST endpoint to handle JSON data
app.post("/", async (req, res) => {
  try {
    const data = req.body;

    // Generate PDF with the received data
    //const pdfPath = await generatePDF(data);

    res.status(200).json({ message: "PDF Generated Successfully!", pdfPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

async function generatePDF() {
  // Load and compile the template

  const templateHtml = fs.readFileSync("templates/invoice.hbs", "utf8");
  const template = Handlebars.compile(templateHtml);

  // Load data
  const data = fs.readJsonSync("data.json", { encoding: "utf8" });

  // Load CSS
  const cssPath = path.resolve(__dirname, "css/style.css");
  const cssContent = fs.readFileSync(cssPath, "utf8");

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
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // Set the content of the page to the generated HTML
  await page.setContent(completeHtml, {
    waitUntil: "domcontentloaded",
  });

  //const htmlRendered = await page.content();
  //fs.writeFileSync("out/output.html", htmlRendered);

  // Create PDF from page content
  const pdf = await page.pdf({ format: "A4" });

  // Save PDF
  fs.writeFileSync("out/output.pdf", pdf);

  console.log("PDF Generated Successfully!");

  await browser.close();
}
