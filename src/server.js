const express = require("express");
const cors = require("cors");
const path = require("path");
const env = require("./config/env");
const apiRouter = require("./routes/api");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

app.use("/api", apiRouter);

app.use((_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`);
});
