const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  const name = req.query.name || "World";
  const responseMessage = `Hello, ${name}. This is a custom HTML/JS execution response.`;
  res.status(200).send(responseMessage);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
