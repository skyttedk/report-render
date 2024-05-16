const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// POST endpoint to handle JSON data
app.post("/", (req, res) => {
  const data = req.body;

  // Process the data (you can add your own logic here)
  const responseMessage = `Received JSON data: ${JSON.stringify(data)}`;

  res.status(200).send(responseMessage);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
